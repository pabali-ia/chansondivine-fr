export async function onRequest(context) {
  const { request, env } = context

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  try {
    const body = await request.json()

    const {
      recipientName,
      occasion,
      description,
      musicStyle,
      email
    } = body

    if (!email || !recipientName) {
      return new Response(JSON.stringify({ error: 'Dados incompletos' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      })
    }

    // Gerar ID único para o pedido
    const orderId = crypto.randomUUID()

    // Salvar dados no KV
    await env.ORDERS.put(orderId, JSON.stringify({
      orderId,
      recipientName,
      occasion,
      description,
      musicStyle,
      email,
      createdAt: new Date().toISOString(),
      status: 'pending'
    }))

    // Montar URL do checkout PerfectPay
    const checkoutUrl = `https://app.perfectpay.com.br/pay/PPPBET8O?email=${encodeURIComponent(email)}&name=${encodeURIComponent(recipientName)}&order_id=${orderId}`

    return new Response(JSON.stringify({
      success: true,
      checkoutUrl,
      orderId
    }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    })

  } catch (err) {
    console.error('Create order error:', err)
    return new Response(JSON.stringify({ error: 'Erro interno' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    })
  }
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