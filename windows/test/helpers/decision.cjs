const questions=require('../../src/questions.json');
module.exports=(refs=[])=>({
 answers:Object.fromEntries(Object.entries(questions).map(([key,q])=>[key,q.type==='choice'?{probabilities:Object.fromEntries(Object.keys(q.criteria).map((k,i)=>[k,i===0?.6:.4/(Object.keys(q.criteria).length-1)]))}:q.type==='noul'?{noul:.75}:{score:3}])),
 analysis:{summary:'对方希望核对修改稿；已有记录中可以找到相关安排。',refs,uncertainties:['没有证据表明修改已经完成。']},
 replies:[{text:'我先核对一下修改要求。',strategy:'确认信息',reason:'避免遗漏或假装已经完成。',refs,probability:.6},{text:'收到，需要重点检查哪部分？',strategy:'澄清重点',reason:'优先补足未知信息。',refs,probability:.3},{text:'好的，我们核对一下安排。',strategy:'简短回应',reason:'保持对话开放。',refs:[],probability:.1}]
});
