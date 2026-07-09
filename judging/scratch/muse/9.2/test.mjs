import { debounceWithFlush } from "./submission.mjs";
let calls=[];
const obj={name:"X"};
const d = debounceWithFlush(function(...a){ calls.push({this:this, a}); }, 50);
// basic debounce: only last fires
d.call(obj,1); d.call(obj,2); d.call(obj,3);
await new Promise(r=>setTimeout(r,80));
console.log("basic last-only + this:", calls.length===1 && calls[0].a[0]===3 && calls[0].this===obj);
// flush pending immediate with last args
calls=[]; d.call(obj,"a"); d.call(obj,"b"); d.flush();
console.log("flush immediate last args:", calls.length===1 && calls[0].a[0]==="b");
await new Promise(r=>setTimeout(r,80));
console.log("flush no double-fire:", calls.length===1);
// flush with nothing pending = no-op
calls=[]; d.flush();
console.log("flush nothing = noop:", calls.length===0);
// cancel then call works
calls=[]; d.call(obj,"x"); d.cancel();
await new Promise(r=>setTimeout(r,80));
console.log("cancel prevents:", calls.length===0);
d.call(obj,"y");
await new Promise(r=>setTimeout(r,80));
console.log("call after cancel works:", calls.length===1 && calls[0].a[0]==="y");
