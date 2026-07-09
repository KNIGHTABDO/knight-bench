function debounceWithFlush(fn, wait) {
let timer=null,args=null,ctx=null
function debounced(...a){
args=a
ctx=this
clearTimeout(timer)
timer=setTimeout(()=>{timer=null;fn.apply(ctx,args);args=ctx=null},wait)
}
debounced.flush=function(){
if(timer!==null){clearTimeout(timer);timer=null;fn.apply(ctx,args);args=ctx=null}
}
debounced.cancel=function(){clearTimeout(timer);timer=null;args=ctx=null}
return debounced
}
export { debounceWithFlush };
