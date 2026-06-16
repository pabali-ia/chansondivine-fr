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
    const orderId = body.metadata?.src || body.metadata?.utm_content || body.order_id || body.tracker_id || body.code

    console.log('Order ID:', orderId, '| Email:', email)

    if (!email || !orderId) {
      return new Response('missing data', { status: 400 })
    }

    // Buscar dados no KV
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

    // Criar tarefa de geração de música
    const prompt = buildPrompt(order)
    console.log('Prompt:', prompt)

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
      return new Response('music task creation failed', { status: 500 })
    }

    const createData = await createResponse.json()
    const generationId = createData?.id

    if (!generationId) {
      console.error('No generation ID received')
      return new Response('no generation id', { status: 500 })
    }

    console.log('Task created, generation_id:', generationId)

    // Salvar tarefa pendente no KV para o cron processar
    await env.ORDERS.put(`pending:${generationId}`, JSON.stringify({
      generationId,
      orderId,
      email: order.email || email,
      recipientName: order.recipientName,
      createdAt: new Date().toISOString(),
      status: 'pending'
    }), { expirationTtl: 86400 }) // expira em 24h

    console.log('Pending task saved to KV:', generationId)

    // Retorna imediatamente — o cron vai buscar o resultado
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

export async function onRequestOptions() {
  return new Response(null, {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    }
  })
}
