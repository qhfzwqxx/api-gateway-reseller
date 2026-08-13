import { createRequire } from 'node:module';
import {
  detectPolicyBlock,
  injectPolicyInstructions,
  sanitizePolicyResponseBody,
  sanitizePolicyResponseHeaders,
  sanitizePolicySseText,
} from '../apps/api/src/services/policy-recovery.ts';

const require = createRequire(import.meta.url);
const exe = require('./fixtures/leila-restored-1.0.2/context-proxy.js');
const buf = (value: unknown) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
const normalizeSignal = (value: unknown) => Boolean(value);
const headersToObject = (headers: Headers) => Object.fromEntries(headers.entries());
const differences: unknown[] = [];

const jsonCases = [
  { name: 'codex header', status: 403, headers: {'x-codex-error-info':'cyberPolicy'}, body: {error:{message:'blocked'}} },
  { name: 'trusted header', status: 403, headers: {'x-verification-recommendation':'trusted_access_for_cyber'}, body: {} },
  { name: 'moderation', status: 200, headers: {}, body: {moderation_response:{blocked:true,metadata:{protection_type:'cyber',safety_limited:true}}} },
  { name: 'policy code', status: 400, headers: {}, body: {error:{code:'policy_violation'}} },
  { name: 'strong structured text', status: 400, headers: {}, body: {error:{message:'Request was blocked by our safety system'}} },
  { name: 'ordinary text', status: 400, headers: {}, body: {error:{message:'ordinary invalid request'}} },
];
for (const item of jsonCases) {
  const a = exe.detectPolicyBlockJson(buf(item.body), item.status, item.headers);
  const b = detectPolicyBlock({statusCode:item.status,headers:item.headers,body:item.body,source:'json'});
  if (normalizeSignal(a) !== normalizeSignal(b)) differences.push({kind:'json-detect',name:item.name,exe:a,gateway:b});
}

const sseCases = [
  {name:'failed policy', text:'event: response.failed\ndata: {"type":"response.failed","response":{"error":{"code":"policy_violation"}}}\n\n'},
  {name:'moderation', text:'data: {"moderation_response":{"blocked":true,"metadata":{"protection_type":"cyber","safety_limited":true}}}\n\n'},
  {name:'substantive then block', text:'event: response.output_text.delta\ndata: {"delta":"hello"}\n\nevent: response.failed\ndata: {"error":{"code":"policy_violation"}}\n\n'},
  {name:'done', text:'data: [DONE]\n\n'},
];
for (const item of sseCases) {
  const a = exe.detectPolicyBlockSse(buf(item.text), 200, {'content-type':'text/event-stream'});
  const values = item.text.split(/\r?\n/).filter(x=>x.startsWith('data:')).map(x=>x.slice(5).trim()).filter(x=>x&&x!=='[DONE]').flatMap(x=>{try{return [JSON.parse(x)]}catch{return []}});
  const b = detectPolicyBlock({statusCode:200,headers:{'content-type':'text/event-stream'},body:values,source:'sse'});
  if (normalizeSignal(a) !== normalizeSignal(b)) differences.push({kind:'sse-detect',name:item.name,exe:a,gateway:b});
}

const bodyCases = [
  {name:'verification scalar', body:{verification:'trusted_access_for_cyber',keep:1}},
  {name:'verification mixed', body:{verification:{recommendation:'trusted_access_for_cyber',keep:'yes'},keep:1}},
  {name:'moderation', body:{moderation_response:{blocked:true,metadata:{protection_type:'cyber',safety_limited:true}},keep:1}},
  {name:'nested array', body:{items:[{codexErrorInfo:'cyberPolicy',keep:1},'trusted_access_for_cyber'],keep:2}},
];
for (const item of bodyCases) {
  const a = JSON.parse(exe.sanitizeJsonBody(buf(item.body)).toString());
  const b = sanitizePolicyResponseBody(item.body);
  if (JSON.stringify(a)!==JSON.stringify(b)) differences.push({kind:'json-sanitize',name:item.name,exe:a,gateway:b});
}

const headerCases = [
  {'x-codex-error-info':'cyberPolicy','x-test':'ok','content-length':'12','content-encoding':'gzip'},
  {'x-verification-recommendation':'trusted_access_for_cyber','openai-verification-recommendation':'trusted_access_for_cyber','x-test':'ok'},
];
for (const input of headerCases) {
  const a = exe.sanitizeResponseHeaders(input);
  const b = headersToObject(sanitizePolicyResponseHeaders(new Headers(input)));
  const normalizedA = Object.fromEntries(Object.entries(a).sort(([left], [right]) => left.localeCompare(right)));
  const normalizedB = Object.fromEntries(Object.entries(b).sort(([left], [right]) => left.localeCompare(right)));
  if (JSON.stringify(normalizedA)!==JSON.stringify(normalizedB)) differences.push({kind:'header-sanitize',input,exe:a,gateway:b});
}

for (const item of sseCases) {
  const a = exe.sanitizeSseBody(buf(item.text)).toString();
  const b = sanitizePolicySseText(item.text);
  if (a!==b) differences.push({kind:'sse-sanitize',name:item.name,exe:a,gateway:b});
}

const injectionCases = [
  {endpoint:'/v1/responses',body:{model:'x',input:'hi',instructions:'original'}},
  {endpoint:'/v1/responses/compact',body:{model:'x',input:'hi',instructions:['original']}},
  {endpoint:'/v1/chat/completions',body:{model:'x',messages:[{role:'user',content:'hi'}]}},
];
for (const item of injectionCases) {
  const originalA=structuredClone(item.body), originalB=structuredClone(item.body);
  const a=exe.buildPayload(originalA,{forceModel:false,model:'x'}, {authorized:false,trigger:null,exclusion:null,scope:''},0,item.endpoint);
  // buildPayload always renders unrelated full context, compare injection shape separately.
  const b=injectPolicyInstructions(originalB as any,item.endpoint,'RULES','developer');
  if(item.endpoint.startsWith('/v1/responses') && !(typeof (b as any).instructions==='string'||Array.isArray((b as any).instructions))) differences.push({kind:'inject-shape',name:item.endpoint,b});
  if(item.endpoint==='/v1/chat/completions' && (b as any).messages?.[0]?.role!=='developer') differences.push({kind:'inject-shape',name:item.endpoint,b});
  void a;
}

const result = { differenceCount: differences.length, differences };
console.log(JSON.stringify(result, null, 2));
if (differences.length > 0) process.exitCode = 1;
