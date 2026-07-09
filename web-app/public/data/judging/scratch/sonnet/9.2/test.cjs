
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const code = fs.readFileSync("submission.js", "utf8");
const ctx = { module: { exports: {} }, exports: {}, setTimeout, clearTimeout, console };
vm.createContext(ctx);
vm.runInContext(code + "\n;globalThis.__fn = typeof debounceWithFlush === 'function' ? debounceWithFlush : module.exports;", ctx);
const debounceWithFlush = ctx.__fn;
assert.equal(typeof debounceWithFlush, "function");
const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  let calls = [];
  const obj = { tag: "ctx" };
  function fn(...args) { calls.push({ thisValue: this, args }); return args.join("-"); }
  const d = debounceWithFlush(fn, 35);
  d.call(obj, "a", 1);
  d.call(obj, "b", 2);
  await sleep(60);
  assert.equal(calls.length, 1, "basic debounce should call once");
  assert.equal(calls[0].thisValue, obj, "this preserved");
  assert.deepEqual(calls[0].args, ["b", 2], "last args preserved");
  d.flush();
  assert.equal(calls.length, 1, "flush with nothing pending is no-op");
  d.call(obj, "c", 3);
  d.flush();
  assert.equal(calls.length, 2, "pending flush invokes immediately");
  assert.deepEqual(calls[1].args, ["c", 3]);
  await sleep(60);
  assert.equal(calls.length, 2, "flush cleared timer");
  d.call(obj, "d", 4);
  d.cancel();
  await sleep(60);
  assert.equal(calls.length, 2, "cancel stops pending");
  d.call(obj, "e", 5);
  await sleep(60);
  assert.equal(calls.length, 3, "call after cancel works");
  assert.deepEqual(calls[2].args, ["e", 5]);
})().catch(e => { console.error(e.stack || e); process.exit(1); });
