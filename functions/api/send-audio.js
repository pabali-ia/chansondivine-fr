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

    const orderData = await env.ORDERS.get(orderId)
    if (!orderData) {
      return new Response('Order not found', { status: 404 })
    }

    const order = JSON.parse(orderData)

    const audioResponse = await fetch(audioUrl)
    const audioBuffer = await audioResponse.arrayBuffer()
    const fileName = orderId + '.mp3'

    await env.AUDIO_BUCKET.put(fileName, audioBuffer, {
      httpMetadata: { contentType: 'audio/mpeg' }
    })

    await env.ORDERS.put(orderId, JSON.stringify(Object.assign({}, order, {
      status: 'delivered',
      audioUrl: audioUrl,
      deliveredAt: new Date().toISOString()
    })))

    const emailHtml = '<div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; padding: 40px 20px; color: #1a1a2e;">'
      + '<div style="text-align: center; margin-bottom: 32px;">'
      + '<h1 style="color: #c9a84c; font-size: 28px;">Chanson Divine</h1>'
      + '<p style="color: #666;">Votre chanson personnalisee est prete</p>'
      + '</div>'
      + '<p style="font-size: 16px; line-height: 1.8; color: #333;">Bonjour,<br><br>'
      + 'Votre chanson pour <strong>' + order.recipientName + '</strong> est prete !</p>'
      + '<div style="text-align: center; margin: 40px 0;">'
      + '<a href="' + audioUrl + '" style="background: #1a1a2e; color: #c9a84c; padding: 16px 40px; border-radius: 50px; text-decoration: none; font-size: 18px; font-weight: bold; display: inline-block;">Ecouter ma chanson</a>'
      + '</div>'
      + '<p style="font-size: 14px; color: #999; text-align: center;">Ce lien est valable 30 jours.</p>'
      + '<hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;">'
      + '<p style="font-size: 14px; color: #999; text-align: center;">Merci de faire confiance a Chanson Divine</p>'
      + '</div>'

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + env.RESEND_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from: 'Chanson Divine <bonjour@chansondivine.fr>',
        to: order.email,
        subject: 'Votre chanson pour ' + order.recipientName + ' est prete !',
        html: emailHtml
      })
    })

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    })

  } catch (err) {
    console.error('Send audio error:', err)
    return new Response('Error', { status: 500 })
  }
}