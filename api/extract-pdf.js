// Vercel serverless function — proxies PDF to Anthropic API
// Avoids CORS issues with direct browser → API calls

export const config = { api: { bodyParser: { sizeLimit: '20mb' } } }

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { pdfBase64, password, bank } = req.body
  if (!pdfBase64) return res.status(400).json({ error: 'No PDF data provided' })

  const prompt = password
    ? `This PDF is password protected with password: "${password}". Extract ALL transactions from this ${bank?.toUpperCase() || 'BANK'} bank statement as a JSON array. Each object must have: date (YYYY-MM-DD), narration (full description text), credit (number, 0 if debit), debit (number, 0 if credit). Return ONLY a valid JSON array, no markdown, no other text.`
    : `Extract ALL transactions from this ${bank?.toUpperCase() || 'BANK'} bank statement as a JSON array. Each object must have: date (YYYY-MM-DD), narration (full description text), credit (number, 0 if debit), debit (number, 0 if credit). Return ONLY a valid JSON array, no markdown, no other text.`

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8000,
        messages: [{
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
            { type: 'text', text: prompt }
          ]
        }]
      })
    })

    const data = await response.json()
    if (data.error) return res.status(500).json({ error: data.error.message })

    const text = data.content?.[0]?.text || ''
    const jsonMatch = text.match(/\[[\s\S]*\]/)
    if (!jsonMatch) return res.status(500).json({ error: 'Could not extract transactions from PDF' })

    const txns = JSON.parse(jsonMatch[0])
    return res.status(200).json({ txns })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  }
}
