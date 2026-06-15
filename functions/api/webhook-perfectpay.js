export async function onRequest(context) {
  const { request, env } = context

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  try {
    const body = await request.json()

    console.log('Webhook received:', JSON.stringify(body))

    // PerfectPay envia status "approved" quando pagamento é aprovado
    if (body.sale_status !== 'approved') {
      console.log('Ignored status:', body.sale_status)
      return new Response('ignored', { status: 200 })
    }

    const email = body.customer?.email
    const name = body.customer?.name

    // ✅ CORRIGIDO: busca o order_id customizado que enviamos na URL do checkout
    const orderId = body.order_id
      || body.tracker_id
      || body.sale_id
      || body.transaction_id

    console.log('Order ID found:', orderId)
    console.log('Email:', email)

    if (!email || !orderId) {
      console.error('Missing data - email:', email, 'orderId:', orderId)
      return new Response('missing data', { status: 400 })
    }

    // Buscar dados do pedido no KV
    let order = {}
    const orderData = await env.ORDERS.get(orderId)

    if (orderData) {
      order = JSON.parse(orderData)
      console.log('Order found in KV:', order.recipientName)
    } else {
      // Fallback: usa dados do PerfectPay se não achar no KV
      console.log('Order not found in KV, using fallback')
      order = {
        recipientName: name || 'cher(e) ami(e)',
        occasion: 'moment spécial',
        description: '',
        musicStyle: 'pop douce romantique',
        email: email
      }
    }

    // Gerar música com Suno via AIML API
    const prompt = buildPrompt(order)
    console.log('Generating music with prompt:', prompt)

    const audioUrl = await generateMusic(prompt, env)

    if (!audioUrl) {
      console.error('Music generation failed')
      return new Response('music generation failed', { status: 500 })
    }

    console.log('Music generated:', audioUrl)

    // Atualizar status no KV
    if (orderData) {
      await env.ORDERS.put(orderId, JSON.stringify({
        ...order,
        status: 'generated',
        audioUrl: audioUrl,
        generatedAt: new Date().toISOString()
      }))
    }

    // Enviar email com Resend
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
    `Une chanson émouvante en français pour ${order.recipientName}`,
    `à l'occasion de ${order.occasion}`,
    `Style musical: ${order.musicStyle}`,
  ]

  if (order.themes && order.themes.length > 0) {
    parts.push(`Thèmes: ${Array.isArray(order.themes) ? order.themes.join(', ') : order.themes}`)
  }

  if (order.description) {
    parts.push(`Histoire et inspiration: ${order.description}`)
  }

  parts.push('Paroles en français uniquement, douce, sincère et très personnelle.')

  return parts.join('. ')
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

    if (!response.ok) {
      const errorText = await response.text()
      console.error('AIML API error:', response.status, errorText)
      return null
    }

    const data = await response.json()
    console.log('AIML API response:', JSON.stringify(data))

    // Tenta diferentes formatos de resposta da API
    return data?.audio_url
      || data?.[0]?.audio_url
      || data?.data?.[0]?.audio_url
      || data?.result?.audio_url
      || null

  } catch (err) {
    console.error('Music generation error:', err)
    return null
  }
}

async function sendEmail(email, recipientName, audioUrl, env) {
  const response = await fetch('https://api.resend.com/emails', {
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
            Nous avons le plaisir de vous envoyer la chanson personnalisée pour
            <strong>${recipientName}</strong>.
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

  if (!response.ok) {
    const err = await response.text()
    console.error('Resend error:', err)
  }
}
