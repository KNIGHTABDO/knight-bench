function debounceWithFlush(fn, wait) {
  let timer = null;
  let lastArgs = null;
  let lastThis = null;
  let pending = false;
  function debounced() {
    lastArgs = arguments;
    lastThis = this;
    pending = true;
    if (timer) clearTimeout(timer);
    timer = setTimeout(function () {
      pending = false;
      timer = null;
      fn.apply(lastThis, lastArgs);
    }, wait);
  }
  debounced.flush = function () {
    if (!pending) return;
    clearTimeout(timer);
    timer = null;
    pending = false;
    fn.apply(lastThis, lastArgs);
  };
  debounced.cancel = function () {
    if (timer) clearTimeout(timer);
    timer = null;
    pending = false;
    lastArgs = null;
    lastThis = null;
  };
  return debounced;
}