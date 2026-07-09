function debounceWithFlush(fn, wait) {
  let timeoutId = null;
  let lastArgs = null;
  let lastThis = null;
  function debounced(...args) {
    lastArgs = args;
    lastThis = this;
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => {
      fn.apply(lastThis, lastArgs);
      timeoutId = lastArgs = lastThis = null;
    }, wait);
  }
  debounced.flush = function() {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
      fn.apply(lastThis, lastArgs);
      timeoutId = lastArgs = lastThis = null;
    }
  };
  debounced.cancel = function() {
    clearTimeout(timeoutId);
    timeoutId = lastArgs = lastThis = null;
  };
  return debounced;
}