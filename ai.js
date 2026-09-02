const topicMap={
  service:[/service|staff|wait|waiting|slow|rude|friendly/i],
  food:[/food|dish|taste|meal|breakfast|dinner|lunch/i],
  ambience:[/ambience|atmosphere|music|clean|interior/i],
  pricing:[/price|cost|expensive|value|cheap/i],
  hygiene:[/clean|dirty|hygiene|washroom/i]
};
const positiveWords=['great','excellent','amazing','love','loved','good','friendly','delicious','quick','best','wonderful'];
const negativeWords=['bad','poor','slow','waiting','rude','dirty','worst','disappointed','cold','late','expensive'];
export function analyzeReview(review){
 const text=(review.text||'').toLowerCase(); let pos=0,neg=0; for(const w of positiveWords)if(text.includes(w))pos++; for(const w of negativeWords)if(text.includes(w))neg++; let sentiment=review.rating>=4?'POSITIVE':review.rating<=2?'NEGATIVE':(pos>neg?'POSITIVE':neg>pos?'NEGATIVE':'NEUTRAL');
 const topics=[]; for(const [k,patterns] of Object.entries(topicMap)) if(patterns.some(r=>r.test(text))) topics.push(k);
 if(!topics.length) topics.push(review.rating>=4?'experience':'service');
 const confidence=Math.min(0.98,0.55+Math.abs(pos-neg)*0.08+(review.rating===5||review.rating===1?0.18:0.08));
 return {sentiment,topics,confidence:Number(confidence.toFixed(2))};
}
export function generateReply(review,{tone='WARM',businessName='our business'}={}){
 const name=review.authorName||'there'; const analysis=analyzeReview(review); const topic=analysis.topics[0];
 if(analysis.sentiment==='POSITIVE') return `Thank you ${name}! We're so happy you enjoyed your experience at ${businessName}. We truly appreciate your kind words about ${topic}, and we look forward to welcoming you again.`;
 if(analysis.sentiment==='NEUTRAL') return `Thank you ${name} for sharing your feedback. We're glad you visited ${businessName}, and we appreciate your comments. We'll use your feedback about ${topic} to keep improving our customer experience.`;
 return `Thank you ${name} for taking the time to share your feedback. We're sorry your experience at ${businessName} didn't meet expectations, especially regarding ${topic}. We'd appreciate the opportunity to learn more and improve our service.`;
}
