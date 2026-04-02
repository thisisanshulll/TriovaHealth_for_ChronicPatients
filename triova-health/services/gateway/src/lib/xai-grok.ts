import { logger } from '@triova/shared';

const XAI_API_URL = 'https://api.x.ai/v1/chat/completions';

interface XAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface XAIResponse {
  id: string;
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

export async function getXAIResponse(
  messages: XAIMessage[],
  maxTokens = 800
): Promise<string> {
  const apiKey = process.env.GROK_API_KEY;
  
  if (!apiKey) {
    throw new Error('GROK_API_KEY not configured');
  }

  try {
    const response = await fetch(XAI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'grok-2',
        messages,
        max_tokens: maxTokens,
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      logger.error('xAI API error', { status: response.status, error: errorText });
      throw new Error(`xAI API error: ${response.status}`);
    }

    const data: XAIResponse = await response.json();
    return data.choices[0]?.message?.content || '';
  } catch (error) {
    logger.error('xAI API failed', error);
    throw error;
  }
}

export async function askXAIContEXT(
  query: string,
  context: string,
  conversationHistory: { role: string; content: string }[] = []
): Promise<string> {
  const NOT_FOUND = 'This information is not available in the uploaded medical records.';

  const systemMessage: XAIMessage = {
    role: 'system',
    content: `You are TRIOVA's medical records assistant. Your role is to help doctors analyze patient medical reports and answer queries about them. 

Guidelines:
1. Answer ONLY from the provided context (patient's medical documents)
2. If the answer is not in the context, say: "${NOT_FOUND}"
3. Do not provide medical advice - direct patients to consult their doctor
4. Be clear and concise when summarizing medical information from reports
5. When referencing documents, mention what type of document it is (prescription, lab report, etc.)
6. Analyze all documents in the context to provide comprehensive answers`
  };

  const messages: XAIMessage[] = [systemMessage];

  const hist = conversationHistory.slice(-10);
  for (const h of hist) {
    if (h.role === 'user' || h.role === 'assistant') {
      messages.push({
        role: h.role as 'user' | 'assistant',
        content: h.content,
      });
    }
  }

  messages.push({
    role: 'user',
    content: `Context from medical documents:\n${context}\n\nQuestion: ${query}`,
  });

  return getXAIResponse(messages);
}