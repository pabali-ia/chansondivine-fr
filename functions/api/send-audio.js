export async function onRequest(context) {
  const { request, env } = context

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  try {
    const body = await request.json()
    const { orderId, audioUrl } = body

    if (!orderId || !audioUrl) {
      return new Response('Missing data', { status: 400 })
    }

    // Buscar dados do pedido no KV
    const orderData = await env.ORDERS.get(orderId)
    if (!orderData) {
      return new Response('Order not found', { status: 404 })
    }

    const order = JSON.parse(orderData)

    // Baixar o áudio e salvar no R2
    const audioResponse = await fetch(audioUrl)
    const audioBuffer = await audioResponse.arrayBuffer()
    const fileName = `${orderId}.mp3`

    await env.AUDIO_BUCKET.put(fileName, audioBuffer, {
      httpMetadata: { contentType: 'audio/mpeg' }
    })

    // Gerar URL pública do R2
    const publicAudioUrl = `https://pub-${env.R2_PUBLIC_URL}.r2.dev/${fileName}`

    // Atualizar status no KV
    await env.ORDERS.put(orderId, JSON.stringify({
      ...order,
      status: 'delivered',
      audioUrl: publicAudioUrl,
      deliveredAt: new Date().toISOString()
    }))

    // Enviar email de entrega
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Chanson Divine <bonjour@chansondivine.fr>',
        to: order.email,
        subject: `🎵 Votre chanson pour ${order.recipientName} est prête !`,
        html: `
          <div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; color: #1a1a2e;">
            <div style="text-align: center; margin-bottom: 32px;">
              <h1 style="color: #c9a84c; font-size: 28px;">Chanson Divine</h1>
              <p style="color: #666;">Votre chanson personnalisée est prête</p>
            </div>
            
            <p style="font-size: 16px; line-height: 1.8; color: #333;">
              Bonjour,<br><br>
              Votre chanson pour <strong>${order.recipientName}</strong> est prête !
              Elle a été créée avec tout notre soin pour rendre ce moment inoubliable.
            </p>
            
            <div style="text-align: center; margin: 40px 0;">
              <a href="${publ