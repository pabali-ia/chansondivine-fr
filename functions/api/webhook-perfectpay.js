export async function onRequest(context) {
  const { request, env } = context

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  try {
    const body = await request.json()
    console.log('Webhook received:', JSON.stringify(body))

    if (body.sale_status !== 'approved') {
      console.log('Ignored status:', body.sale_status)
      return new Response('ignored', { status: 200 })
    }

    const email = body.customer?.email
    const name = body.customer?.name
    const orderId = body.order_id || body.tracker_id || body.tracker || body.sale_id || body.transaction_id

    console.log('Order ID:', orderId, '| Email:', email)

    if (!email || !orderId) {
      return new Response('missing data', { status: 400 })
    }

    let order = {}
    const orderData = await env.ORDERS.get(orderId)
    if (orderData) {
      order = JSON.parse(orderData)
      console.log('Order found in KV:', order.recipientName)
    } else {
      console.log('Order not found in KV, using fallback')
      order = {
        recipientName: name || 'cher(e) ami(e)',
        occasion: 'moment special',
        description: '',
        musicStyle: 'pop douce romantique',
        email: email
      }
    }

    const prompt = buildPrompt(order)
    console.log('Prompt:', prompt)

    const audioUrl = await generateMusic(prompt, env)

    if (!audioUrl) {
      console.error('Music generation failed')
      return new Response('music generation failed', { status: 500 })
    }

    console.log('Music URL:', audioUrl)

    if (orderData) {
      await env.ORDERS.put(orderId, JSON.stringify({
        ...order,
        status: 'delivered',
        audioUrl,
        deliveredAt: new Date().toISOString()
      }))
    }

    await sendEmail(order.email || email, order.recipientName, audioUrl, env)
    console.log('Email sent to:', order.email || email)

    return new Response('ok', { status: 200 })

  } catch (err) {
    console.error('Webhook error:', err)
    return new Response('error', { status: 500 })
  }
}

function buildPrompt(order) {
  const parts = [
    `Une chanson emouvante en francais pour ${order.recipientName}`,
    `a l'occasion de ${order.occasion}`,
    `Style musical: ${order.musicStyle}`,
  ]
  if (order.themes && order.themes.length > 0) {
    parts.push(`Themes: ${Array.isArray(order.themes) ? order.themes.join(', ') : order.themes}`)
  }
  if (order.description) {
    parts.push(`Histoire: ${order.description}`)
  }
  parts.push('Paroles en francais uniquement, douce, sincere et tres personnelle.')
  return parts.join('. ')
}

async function generateMusic(prompt, env) {
  try {
    // ETAPE 1 - Creer la tache
    const createResponse = await fetch('https://api.aimlapi.com/v2/generate/audio', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.AIMUSIC_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'minimax/music-2.6',
        prompt: prompt,
        lyrics_optimizer: true,
        is_instrumental: false,
        audio_setting: {
          format: 'mp3',
          bitrate: 128000,
          audio_sample_rate: 44100
        }
      })
    })

    if (!createResponse.ok) {
      const err = await createResponse.text()
      console.error('Create task error:', createResponse.status, err)
      return null
    }

    const createData = await createResponse.json()
    console.log('Task created:', JSON.stringify(createData))

    const generationId = createData?.id
    if (!generationId) {
      console.error('No generation ID received')
      return null
    }

    // ETAPE 2 - Polling (max 10 minutes, 15s interval)
    const maxAttempts = 40
    const intervalMs = 15000

    for (let i = 0; i < maxAttempts; i++) {
      await new Promise(resolve => setTimeout(resolve, intervalMs))

      const pollResponse = await fetch(`https://api.aimlapi.com/v2/generate/audio?generation_id=${generationId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${env.AIMUSIC_API_KEY}`,
          'Content-Type': 'application/json'
        }
      })

      if (!pollResponse.ok) {
        console.error('Poll error:', pollResponse.status)
        continue
      }

      const pollData = await pollResponse.json()
      console.log(`Poll ${i + 1} status:`, pollData.status)

      if (pollData.status === 'completed') {
        const url = pollData?.audio_file?.url
        console.log('Audio URL:', url)
        return url || null
      }

      if (pollData.status === 'error') {
        console.error('Generation error:', JSON.stringify(pollData.error))
        return null
      }
    }

    console.error('Timeout: music generation took too long')
    return null

  } catch (err) {
    console.error('generateMusic exception:', err)
    return null
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
