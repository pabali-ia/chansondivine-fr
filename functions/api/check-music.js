// Cloudflare Pages Cron Job — roda a cada minuto
// Verifica tarefas pendentes no KV e envia email quando completar

export async function scheduled(event, env, ctx) {
  console.log('Cron started:', new Date().toISOString())

  try {
    // Listar todas as tarefas pendentes
    const list = await env.ORDERS.list({ prefix: 'pending:' })
    console.log('Pending tasks found:', list.keys.length)

    for (const key of list.keys) {
      try {
        const taskData = await env.ORDERS.get(key.name)
        if (!taskData) continue

        const task = JSON.parse(taskData)
        console.log('Checking task:', task.generationId)

        // Verificar status na AIML API
        const pollResponse = await fetch(
          `https://api.aimlapi.com/v2/generate/audio?generation_id=${task.generationId}`,
          {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${env.AIMUSIC_API_KEY}`,
              'Content-Type': 'application/json'
            }
          }
        )

        if (!pollResponse.ok) {
          console.error('Poll error:', pollResponse.status)
          continue
        }

        const pollData = await pollResponse.json()
        console.log('Task status:', task.generationId, pollData.status)

        if (pollData.status === 'completed') {
          const audioUrl = pollData?.audio_file?.url
          if (!audioUrl) {
            console.error('No audio URL in completed task')
            continue
          }

          console.log('Music ready! URL:', audioUrl)

          // Enviar email
          await sendEmail(task.email, task.recipientName, audioUrl, env)
          console.log('Email sent to:', task.email)

          // Remover tarefa pendente
          await env.ORDERS.delete(key.name)
          console.log('Pending task removed:', key.name)

        } else if (pollData.status === 'error') {
          console.error('Task error:', JSON.stringify(pollData.error))
          await env.ORDERS.delete(key.name)
        } else {
          console.log('Task still', pollData.status, '- will check next cron')
        }

      } catch (taskErr) {
        console.error('Error processing task:', key.name, taskErr)
      }
    }

    console.log('Cron finished')

  } catch (err) {
    console.error('Cron error:', err)
  }
}

async function sendEmail(email, recipientName, audioUrl, env) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'Chanson Divine <bonjour@chansondivine.fr>',
      to: email,
      subject: `Votre chanson pour ${recipientName} est prete !`,
      html: `
        <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; color: #1a1a2e;">
          <div style="text-align: center; margin-bottom: 32px;">
            <h1 style="color: #c9a84c; font-size: 28px; margin-bottom: 8px;">Chanson Divine</h1>
            <p style="color: #666; font-size: 16px;">Votre chanson personnalisee est prete</p>
          </div>
          <p style="font-size: 18px; line-height: 1.6;">Bonjour,</p>
          <p style="font-size: 16px; line-height: 1.8; color: #333;">
            Nous avons le plaisir de vous envoyer la chanson personnalisee pour
            <strong>${recipientName}</strong>.
            Elle a ete creee avec tout notre soin pour rendre ce moment inoubliable.
          </p>
          <div style="text-align: center; margin: 40px 0;">
            <a href="${audioUrl}"
               style="background: linear-gradient(135deg, #1a1a2e, #16213e); color: #c9a84c;
                      padding: 16px 40px; border-radius: 50px; text-decoration: none;
                      font-size: 18px; font-weight: bold; display: inline-block;">
              Ecouter ma chanson
            </a>
          </div>
          <p style="font-size: 14px; color: #999; text-align: center; margin-top: 40px;">
            Ce lien est valable 30 jours.
          </p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;">
          <p style="font-size: 14px; color: #999; text-align: center;">
            Merci de faire confiance a Chanson Divine
          </p>
        </div>
      `
    })
  })

  if (!res.ok) {
    console.error('Resend error:', await res.text())
  }
}
