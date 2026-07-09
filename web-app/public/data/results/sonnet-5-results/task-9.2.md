```js
function debounceWithFlush(fn, wait) {
  let timer = null;
  let lastArgs = null;
  let lastThis = null;

  function debounced(...args) {
    lastArgs = args;
    lastThis = this;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn.apply(lastThis, lastArgs);
    }, wait);
  }

  debounced.flush = function () {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
    fn.apply(lastThis, lastArgs);
  };

  debounced.cancel = function () {
    clearTimeout(timer);
    timer = null;
  };

  return debounced;
}
```