import { Router } from 'express';
import multer from 'multer';
import { authMiddleware, apiRateLimit, type AuthedRequest } from '@triova/shared';
import { getChatModel, getOpenAI, withOpenAIRetry } from '../../lib/openai.js';
import { extractPdfText } from '../processors/pdf-processor.js';
import { ocrImageBuffer } from '../processors/image-processor.js';

const upload = multer({ storage: multer.memoryStorage() });

const router = Router();
router.use(authMiddleware);
router.use(apiRateLimit);

router.post('/extract-medications', upload.single('file'), async (req: AuthedRequest, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'File required' });
    }

    const patientId = String(req.body.patient_id);
    if (req.user!.role === 'patient' && req.user!.patientId !== patientId) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    let extractedText = '';
    
    if (req.file.mimetype === 'application/pdf') {
      extractedText = await extractPdfText(req.file.buffer);
    } else if (req.file.mimetype.startsWith('image/')) {
      extractedText = await ocrImageBuffer(req.file.buffer);
    } else {
      return res.status(400).json({ error: 'Unsupported file type' });
    }

    if (!extractedText?.trim()) {
      return res.json({ 
        extracted_medications: [], 
        message: 'Could not extract text from the document. Please try with a clearer image.' 
      });
    }

    const openai = getOpenAI();
    if (!openai) {
      return res.status(503).json({ error: 'AI service not available' });
    }

    const completion = await withOpenAIRetry(() =>
      openai.chat.completions.create({
        model: getChatModel(),
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: `You are a medical prescription parser. Your ONLY job is to extract medication details from prescription text and return valid JSON.

CRITICAL: Return ONLY a JSON object, nothing else. No explanations, no markdown, no text before or after.

Return this exact JSON structure:
{"medications": [{"medication_name": "string", "dosage": "string", "frequency": "string", "timing": "string", "duration_days": number, "instructions": "string"}]}

IMPORTANT EXTRACTION RULES:
1. medication_name: Exact medicine name (e.g., "Amoxicillin", "Paracetamol 500mg", "Cetrizine 10mg", "Aspirin")
2. dosage: Dosage amount (e.g., "500mg", "10ml", "1 tablet", "2 capsules")
3. frequency: How often per day in simple terms (e.g., "once daily", "twice daily", "three times a day", "every 8 hours", "four times daily")
4. timing: When to take (e.g., "after meals", "before food", "at night", "with food", "before bedtime", "on empty stomach")
5. duration_days: Number of days (e.g., 5, 7, 14, 30). If not specified, estimate based on typical treatment: antibiotics=7, pain=3, chronic=30
6. instructions: Additional instructions from doctor (e.g., "complete full course", "avoid alcohol", "take with water")

SEARCH PATTERNS:
- Look for medicine names, drug names, tablet names, capsule names, syrup names
- Find dosage like "500mg", "250mg", "10ml", "1 tablet", "2 capsules"
- Find frequency like "1-0-1", "1-1-1", "twice daily", "BD", "TDS", "OD"
- Find duration like "5 days", "1 week", "for 7 days", "x 7 days"
- Find timing like "after food", "before food", "with food", "empty stomach", "at night"

If NO medications found, return: {"medications": []}`
          },
          {
            role: 'user',
            content: `Extract ALL medications from this prescription. Include every medicine you find.\n\nPrescription Text:\n${extractedText.slice(0, 15000)}`
          },
        ],
        temperature: 0.1,
      })
    );

    const raw = completion.choices[0]?.message?.content || '{"medications":[]}';
    let meds: Array<{ medication_name: string; dosage: string; frequency: string; timing: string; duration_days: number; instructions: string }> = [];
    
    try {
      const p = JSON.parse(raw) as { medications?: Array<{ medication_name: string; dosage: string; frequency: string; timing: string; duration_days: number; instructions: string }> };
      meds = p.medications || [];
    } catch {
      return res.json({ 
        extracted_medications: [], 
        message: 'Could not parse medications from the prescription.' 
      });
    }

    res.json({
      extracted_medications: meds,
      message: meds.length > 0 ? `Found ${meds.length} medication(s)` : 'No medications found'
    });

  } catch (e) {
    next(e);
  }
});

export default router;