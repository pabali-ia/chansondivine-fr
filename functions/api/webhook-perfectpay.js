export async function onRequest(context) {
  const { request, env } = context

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  try {
    const body = await request.json()

    // PerfectPay envia status "approved" quando pagamento é aprovado
    if (body.sale_status !== 'approved') {
      return new Response('ignored', { status: 200 })
    }

    const email = body.customer?.email
    const name = body.customer?.name
    const orderId = body.sale_id || body.transaction_id

    if (!email || !orderId) {
      return new Response('missing data', { status: 400 })
    }

    // Buscar dados do pedido no KV
    const orderData = await env.ORDERS.get(orderId)
    let order = {}
    if (orderData) {
      order = JSON.parse(orderData)
    } else {
      order = {
        recipientName: name || 'cher(e) ami(e)',
        occasion: 'moment spécial',
        description: '',
        musicStyle: 'pop douce',
        email: email
      }
    }

    // Gerar música com AI Music API
    const prompt = buildPrompt(order)
    const audioUrl = await generateMusic(prompt, env)

    if (!audioUrl) {
      return new Response('music generation failed', { status: 500 })
    }

    // Enviar email com Resend
    await sendEmail(order.email || email, order.recipientName, audioUrl, env)

    return new Response('ok', { status: 200 })

  } catch (err) {
    console.error('Webhook error:', err)
    return new Response('error', { status: 500 })
  }
}

function buildPrompt(order) {
  return `Une chanson émouvante en français pour ${order.recipientName}, à l'occasion de ${order.occasion}. Style: ${order.musicStyle}. ${order.description ? 'Inspiration: ' + order.description : ''}. Paroles en français uniquement, douce et sincère.`
}

async function generateMusic(prompt, env) {
  try {
    const response = await fetch('https://api.aimlapi.com/v2/generate/audio/suno-ai/clip', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.AIMUSIC_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt: prompt,
        make_instrumental: false,
        wait_audio: true
      })
    })

    const data = await response.json()
    return data?.audio_url || data?.[0]?.audio_url || null

  } catch (err) {
    console.error('Music generation error:', err)
    return null
  }
}

async function sendEmail(email, recipientName, audioUrl, env) {
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: 'Chanson Divine <bonjour@chansondivine.fr>',
      to: email,
      subject: `🎵 Votre chanson pour ${recipientName} est prête !`,
      html: `
        <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; color: #1a1a2e;">
          <div style="text-align: center; margin-bottom: 32px;">
            <h1 style="color: #c9a84c; font-size: 28px; margin-bottom: 8px;">Chanson Divine</h1>
            <p style="color: #666; font-size: 16px;">Votre chanson personnalisée est prête</p>
          </div>
          
          <p style="font-size: 18px; line-height: 1.6;">Bonjour,</p>
          
          <p style="font-size: 16px; line-height: 1.8; color: #333;">
            Nous avons le plaisir de vous envoyer la chanson personnalisée pour <strong>${recipientName}</strong>. 
            Elle a été créée avec tout notre soin pour rendre ce moment inoubliable.
          </p>
          
          <div style="text-align: center; margin: 40px 0;">
            <a href="${audioUrl}" 
               style="background: linear-gradient(135deg, #1a1a2e, #16213e); color: #c9a84c; 
                      padding: 16px 40px; border-radius: 50px; text-decoration: none; 
                      font-size: 18px; font-weight: bold; display: inline-block;">
              🎵 Écouter ma chanson
            </a>
          </div>
          
          <p style="font-size: 14px; color: #999; text-align: center; margin-top: 40px;">
            Ce lien est valable 30 jours.<br>
            Pensez à télécharger votre chanson pour la conserver.
          </p>
          
          <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;">
          
          <p style="font-size: 14px; color: #999; text-align: center;">
            Merci de faire confiance à Chanson Divine 🎶<br>
            <a href="https://chansondivine.fr" style="color: #c9a84c;">chansondivine.fr</a>
          </p>
        </div>
      `
    })
  })
}
