# MADAR - مدار — Landing Page

```html
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>MADAR — مدار</title>
<style>
:root{
--bg:#090806;
--bg2:#12100C;
--paper:#EDE6D6;
--paper2:#C2A878;
--blood:#E11D0F;
--blood2:#8E160D;
--line:rgba(237,230,214,.14);
--line2:rgba(237,230,214,.28);
--font-ar-d: "Sakkal Majalla","Traditional Arabic","Geeza Pro","Noto Naskh Arabic","Amiri",serif;
--font-fr-d: "Times New Roman","Palatino","Instrument Serif",serif;
--font-ar-t: "Simplified Arabic","Geeza Pro","Segoe UI",system-ui,sans-serif;
--font-fr-t: "Helvetica Neue","Inter","Suisse Intl","Segoe UI",system-ui,sans-serif;
--font-mono: Consolas,Monaco,monospace;
--sy:0;
}
*{margin:0;padding:0;box-sizing:border-box}
html{background:var(--bg);scroll-behavior:smooth}
body{background:var(--bg);color:var(--paper);font-family:var(--font-ar-t);overflow-x:hidden;-webkit-font-smoothing:antialiased}
img{max-width:100%}
::selection{background:var(--blood);color:var(--paper)}
.grain{position:fixed;inset:0;pointer-events:none;z-index:999;opacity:.055;mix-blend-mode:screen;background-image:url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="4" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/></filter><rect width="100%" height="100%" filter="url(%23n)"/></svg>')}
#loader{position:fixed;inset:0;background:var(--bg);z-index:1000;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:18px;transition:opacity .9s cubic-bezier(.8,0,.2,1),transform 1s}
#loader.hide{opacity:0;pointer-events:none;transform:scale(1.02)}
#loader .l-track{width:140px;height:1px;background:var(--line);overflow:hidden;position:relative}
#loader .l-bar{position:absolute;inset:0;background:var(--paper);transform-origin:right;animation:loadbar 2s cubic-bezier(.8,0,.2,1) forwards}
@keyframes loadbar{0%{transform:scaleX(0)}20%{transform:scaleX(.2)}100%{transform:scaleX(1)}}
.mono{font-family:var(--font-mono);font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--line2)}
.top{position:relative;z-index:2;display:flex;justify-content:space-between;align-items:center;padding:18px 24px;border-bottom:1px solid var(--line);font-family:var(--font-mono)}
.top .mid{font-size:11px;color:var(--paper2)}
.hero{position:relative;min-height:92vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:6vh 24px 8vh;text-align:center;overflow:hidden}
.hero-bg{position:absolute;inset:0;background:radial-gradient(120% 80% at 50% 10%, rgba(194,168,120,.18), transparent 60%),radial-gradient(90% 60% at 80% 80%, rgba(225,29,15,.12), transparent 50%);pointer-events:none}
.mark-wrap{position:relative;display:inline-block;padding:4vw 6vw}
.mark{font-family:var(--font-ar-d);font-size:clamp(96px,22vw,380px);line-height:.82;letter-spacing:-.06em;font-weight:400;display:flex;gap:.04em;direction:rtl;transform-origin:center center;will-change:transform,letter-spacing,opacity}
.mark span{display:inline-block;clip-path:inset(0 0 0 0);transform:translateY(0);transition:transform 1.3s cubic-bezier(.2,.8,.2,1),clip-path 1.2s cubic-bezier(.2,.8,.2,1)}
body:not(.ready) .mark span{clip-path:inset(100% 0 0 0);transform:translateY(80px)}
.mark .r{transform-origin:bottom}
.track{position:absolute;inset:-2% -3% 6% -1%;border:1px solid var(--line2);border-radius:50%;transform:rotate(-7deg) scale(.96);pointer-events:none}
.track:before{content:"";position:absolute;inset:10px;border:1px dashed rgba(237,230,214,.09);border-radius:50%}
.dot{position:absolute;width:8px;height:8px;background:var(--blood);border-radius:50%;top:50%;left:50%;box-shadow:0 0 18px var(--blood);animation:orbit 7s linear infinite}
.dot.s2{width:4px;height:4px;background:var(--paper2);animation-duration:10s;animation-direction:reverse;opacity:.7}
@keyframes orbit{0%{transform:rotate(0deg) translateX(53%) rotate(0deg)}100%{transform:rotate(360deg) translateX(53%) rotate(-360deg)}}
.tag{margin-top:2vh;max-width:560px}
.tag-ar{font-family:var(--font-ar-d);font-size:clamp(22px,3.2vw,34px);line-height:1.2;color:var(--paper)}
.tag-fr{font-family:var(--font-fr-t);font-size:14px;line-height:1.5;color:var(--paper2);margin-top:12px;letter-spacing:.01em}
.fr{font-family:var(--font-fr-t);direction:ltr}
.ltr{direction:ltr}
.sec{position:relative;border-top:1px solid var(--line);padding:0 24px}
.sec-label{display:flex;justify-content:space-between;padding:18px 0;font-family:var(--font-mono);font-size:10px;color:var(--line2);letter-spacing:.15em}
.rail-wrap{overflow:hidden;padding:12px 0 40px;margin:0 -24px}
.rail{display:flex;gap:1px;will-change:transform;transition:transform .1s linear}
.card{flex:0 0 34vw;min-width:300px;max-width:420px;background:var(--bg2);border:1px solid var(--line);position:relative}
.card .still{aspect-ratio:4/3;background:linear-gradient(180deg,rgba(237,230,214,.08),rgba(0,0,0,.6)),radial-gradient(80% 70% at 30% 20%, rgba(194,168,120,.35), transparent),#1A1814;position:relative;overflow:hidden}
.card .still:after{content:"";position:absolute;inset:0;background:repeating-linear-gradient(90deg,transparent,transparent 2px, rgba(0,0,0,.12) 2px, rgba(0,0,0,.12) 3px)}
.card .still i{position:absolute;inset:22%;border:1px solid rgba(237,230,214,.18);border-radius:2px}
.card-meta{padding:16px;display:flex;justify-content:space-between;align-items:baseline;gap:12px}
.card-meta h3{font-family:var(--font-ar-d);font-size:22px;line-height:1.1}
.card-meta .fr{font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:var(--paper2)}
.manif{display:grid;grid-template-columns:1.2fr .8fr;gap:48px;padding:48px 0 80px;align-items:start}
@media(max-width:880px){.manif{grid-template-columns:1fr;gap:32px}.card{flex:0 0 78vw}}
.manif-ar{font-family:var(--font-ar-d);font-size:clamp(24px,2.8vw,38px);line-height:1.35;letter-spacing:-.01em}
.manif-ar em{font-style:normal;color:var(--paper2);border-bottom:1px solid var(--line2)}
.manif-fr{font-family:var(--font-fr-t);font-size:15px;line-height:1.7;color:rgba(237,230,214,.72)}
.manif-fr strong{color:var(--paper);font-weight:400;font-family:var(--font-ar-d);font-size:18px;display:block;margin:24px 0 8px}
.kicker{font-family:var(--font-mono);font-size:10px;letter-spacing:.18em;color:var(--blood);margin-bottom:18px}
.reveal{opacity:0;transform:translateY(24px);transition:opacity .9s cubic-bezier(.2,.8,.2,1),transform .9s}
.reveal.in{opacity:1;transform:none}
.invite{padding:64px 0 96px;display:flex;flex-direction:column;align-items:center;text-align:center}
.invite-box{width:100%;max-width:560px;border:1px solid var(--line2);padding:36px 28px;background:linear-gradient(180deg, rgba(237,230,214,.04), transparent)}
.invite-box h2{font-family:var(--font-ar-d);font-size:42px;line-height:1}
.invite-box .mono{margin-top:8px}
.field{display:flex;gap:8px;margin-top:28px;border-bottom:1px solid var(--line2);padding-bottom:8px}
.field input{flex:1;background:transparent;border:0;color:var(--paper);font-family:var(--font-ar-t);font-size:16px;outline:0;text-align:right}
.field input::placeholder{color:rgba(237,230,214,.35)}
.btn{background:var(--paper);color:var(--bg);border:0;padding:12px 18px;font-family:var(--font-mono);font-size:11px;letter-spacing:.12em;cursor:pointer;transition:background .2s}
.btn:hover{background:var(--paper2)}
.foot{display:flex;justify-content:space-between;gap:24px;padding:22px 24px;border-top:1px solid var(--line);font-family:var(--font-mono);font-size:10px;color:rgba(237,230,214,.45)}
.prog{position:fixed;top:0;right:0;left:auto;width:2px;height:100vh;background:var(--line);z-index:5;transform-origin:top}
.prog i{display:block;width:100%;background:var(--blood);height:100%;transform:scaleY(var(--p,0));transform-origin:top;transition:transform .1s}
</style>
</head>
<body>
<div class="grain"></div>
<div class="prog"><i id="prog"></i></div>
<div id="loader"><div class="mono">MADAR — مدار — تحميل</div><div class="l-track"><div class="l-bar"></div></div></div>

<header class="top">
<div>◐ دعوة فقط</div>
<div class="mid">Arch. 1969—2026 / 24 FPS / INVITE ONLY</div>
<div dir="ltr" class="fr" style="font-size:10px">N°001 — PARIS / TUNIS / BEYROUTH</div>
</header>

<main>
<section class="hero" id="hero">
<div class="hero-bg"></div>
<div class="mark-wrap" id="markWrap">
<div class="track"></div>
<div class="dot"></div>
<div class="dot s2"></div>
<h1 class="mark" id="mark">
<span class="m">م</span><span class="d">د</span><span class="a">ا</span><span class="r">ر</span>
</h1>
</div>
<div class="tag reveal">
<div class="tag-ar">سينما تدور حولك، لا خوارزمية تدور عليك. ثلاثة أفلام كل قمر.</div>
<div class="tag-fr fr" dir="ltr" lang="fr">Cinéma arabe d’auteur en orbite. Pas d’algorithme. Pas de catalogue infini. Trois films par lune, présentés comme une séance.</div>
</div>
<div class="mono" style="margin-top:6vh">↓ مرّر — FAIRE DÉFILER</div>
</section>

<section class="sec">
<div class="sec-label"><span>المجموعة — COLLECTION 01</span><span class="ltr">RAIL / SCROLL-DRIVEN</span></div>
<div class="rail-wrap"><div class="rail" id="rail">
<div class="card reveal"><div class="still"><i></i></div><div class="card-meta"><h3>سماء ملبدة</h3><span class="fr">01 — Ciel Couvert — Tunsis 1974</span></div></div>
<div class="card reveal"><div class="still" style="background:linear-gradient(180deg,rgba(225,29,15,.18),rgba(0,0,0,.6)),#1A1814"><i style="inset:12% 18%"></i></div><div class="card-meta"><h3>عطلة في الشتات</h3><span class="fr">02 — Trêve — Beyrouth 1982</span></div></div>
<div class="card reveal"><div class="still"><i style="border-radius:50%"></i></div><div class="card-meta"><h3>مدار الليل</h3><span class="fr">03 — Orbite — Alger 1969 / Rest. 2024</span></div></div>
<div class="card reveal"><div class="still"><i style="inset:28%"></i></div><div class="card-meta"><h3>ما بعد الصمت</h3><span class="fr">04 — Après — Le Caire 1991</span></div></div>
</div></div>
</section>

<section class="sec">
<div class="sec-label"><span>البيان — MANIFESTE</span><span class="ltr">EDITORIAL / BILINGUE</span></div>
<div class="manif">
<div class="manif-ar reveal"><div class="kicker">بيان مدار</div>مدار ليس منصة. هو <em>مسافة محافظة</em> بين العين والصورة. نعيد أفلاماً عربية كادت أن تضيع، مرممة على ٤K، بلا ضغط، بلا اقتراحات. كل دورة قمرية، نعرض ثلاث أفلام فقط — كأنك تدخل قاعة سينما في منتصف الليل.<br><br>لا خلاصات. لا شريط لا نهائي. فقط فيلم، ومقال، وحوار.<div style="margin-top:28px;font-family:var(--font-mono);font-size:11px;color:var(--line2)">— التأسيس: خريف ٢٠٢٥</div></div>
<div class="manif-fr reveal" dir="ltr" lang="fr"><div class="kicker" style="text-align:left">MANIFESTE</div><strong>Madar n'est pas une plateforme.</strong>C'est une distance conservée entre l'œil et l'image. Nous exhumons des films arabes en voie de disparition, restaurés en 4K, sans compression, sans recommandations.<br><br>Chaque lunaison: trois films seulement. Comme entrer dans une salle à minuit. Un film, un texte, une conversation.<br><strong>Ce que nous refusons:</strong>— le scroll infini, le résumé IA, le doublage auto, le gris startup.<br><br><span style="font-family:var(--font-mono);font-size:10px;color:var(--line2);letter-spacing:.12em">FONDÉ AUTOMNE 2025 — SUR INVITATION</span></div>
</div>
</section>

<section class="sec invite">
<div class="invite-box reveal">
<h2>اطلب مدارك</h2>
<div class="mono" dir="ltr">DEMANDE D'INVITATION — 1 PLACE / TRIMESTRE</div>
<div class="field"><input id="email" placeholder="بريدك — ton@email.fr" dir="auto"/><button class="btn" id="btn">اطلب دعوة — ENVOYER</button></div>
<div class="mono" style="margin-top:14px;line-height:1.5" dir="ltr">Réponse sous 48h. Pas de newsletter. Pas de pub.<br>Réservé aux cinéphiles — 3 films / lune — 6€</div>
<div id="msg" class="mono" style="margin-top:14px;color:var(--paper2)"></div>
</div>
</section>
</main>

<footer class="foot"><span>مدار © ٢٠٢٦ — صمم كتتابع عناوين</span><span dir="ltr">MADE FOR DARK ROOMS — CONÇU POUR LE NOIR — NO TRACKERS — NO CDN — ONE FILE</span></footer>

<script>
const $=s=>document.querySelector(s);
const loader=$('#loader'),mark=$('#mark'),rail=$('#rail'),prog=$('#prog');
let raf=false;
function ready(){
 setTimeout(()=>{
  document.body.classList.add('ready');
  loader.classList.add('hide');
 },1850);
}
ready();
const obs=new IntersectionObserver(es=>{
 es.forEach(e=>{if(e.isIntersecting)e.target.classList.add('in')})
},{threshold:.18});
document.querySelectorAll('.reveal').forEach(el=>obs.observe(el));
let sy=0;
window.addEventListener('scroll',()=>{
 if(raf) return;
 raf=true;
 requestAnimationFrame(()=>{
  sy=window.scrollY;
  const h=document.documentElement.scrollHeight-innerHeight;
  const p=h>0?sy/h:0;
  document.documentElement.style.setProperty('--p',p);
  prog.style.transform=`scaleY(${p})`;
  const fade=Math.max(.12,1-sy*0.0011);
  const scale=1+sy*0.00018;
  const ls=-0.06+sy*0.00011;
  mark.style.opacity=fade;
  mark.style.transform=`scale(${scale}) rotate(${sy*0.004}deg)`;
  mark.style.letterSpacing=ls+'em';
  if(rail){
   const off=sy*0.35;
   rail.style.transform=`translate3d(${-off}px,0,0)`;
  }
  raf=false;
 });
},{passive:true});
$('#btn').addEventListener('click',()=>{
 const v=$('#email').value.trim();
 const m=$('#msg');
 if(!v || !v.includes('@')){m.textContent='— بريد غير صالح / email invalide';m.style.color='var(--blood)';return;}
 m.style.color='var(--paper2)';
 m.textContent='تم — invitation enregistrée. تحقق من بريدك.';
 $('#email').value='';
});
document.addEventListener('mousemove',e=>{
 const x=(e.clientX/innerWidth-0.5)*12;
 const y=(e.clientY/innerHeight-0.5)*-10;
 $('#markWrap').style.transform=`perspective(800px) rotateY(${x}deg) rotateX(${y}deg)`;
});
</script>
</body>
</html>
```

DESIGN RATIONALE:
Concept: مدار means orbit — the page itself orbits the word; film-studio title sequence where a single red dot circles the logotype like a projector lamp, not SaaS.
Palette: obsidian black #090806 + warm bone #EDE6D6 + archival red #E11D0F + desert sand #C2A878 — committed, no grey, no purple, restraint in use.
Typography: display Naskh Arabic (Sakkal Majalla/Traditional) at 22vw vs mono 10px / Helvetica-Neue fr — editorial scale contrast, Arabic-first RTL with French secondary correctly mirrored ltr.
Motion: 1 time-driven loader + staggered clip-path intro + perpetual orbital dot, 2 scroll-driven parallax/scale+opacity of wordmark and horizontal film rail scrub — choreographed not confetti.
NOT: no gradients mesh, no cards shadow, no hamburger, no infinite scroll, no stock icons — kept single-file, cinematic, quiet.
