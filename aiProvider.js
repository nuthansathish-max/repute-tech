import { analyzeReview, generateReply } from './ai.js';

export async function aiReviewAnalysis(review, businessName, tone='WARM') {
  if (!process.env.OPENAI_API_KEY) return { provider:'local', ...analyzeReview(review), reply:generateReply(review,{tone,businessName}) };
  const body={model:process.env.OPENAI_MODEL||'gpt-5-mini',input:[{role:'system',content:'You are a review-management assistant. Return only JSON with sentiment, topics, confidence, and reply. Never fabricate facts, never offer incentives for reviews, and keep replies concise.'},{role:'user',content:JSON.stringify({businessName,tone,review})}],text:{format:{type:'json_schema',name:'review_analysis',schema:{type:'object',additionalProperties:false,properties:{sentiment:{type:'string',enum:['POSITIVE','NEUTRAL','NEGATIVE']},topics:{type:'array',items:{type:'string'}},confidence:{type:'number'},reply:{type:'string'}},required:['sentiment','topics','confidence','reply']}}}};
  const r=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:`Bearer ${process.env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!r.ok) throw new Error(`AI provider error ${r.status}`);
  const data=await r.json(); const text=data.output_text||data.output?.flatMap(x=>x.content||[]).find(x=>x.text)?.text; if(!text) throw new Error('AI provider returned no text');
  return {provider:'openai',...JSON.parse(text)};
}
