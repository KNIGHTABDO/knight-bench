```html
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>مدار — سينما عربية، على الدعوة فقط</title>
<style>
  :root{
    --ink:#0a0d0c;
    --night:#111815;
    --rust:#a8402b;
    --rust-dim:#6e2a1c;
    --gold:#c99a44;
    --gold-bright:#e7c06f;
    --sand:#ece2cc;
    --sand-dim:#a89a80;
    --teal:#173b39;
    --display-ar:"Traditional Arabic","Arabic Typesetting","Al Bayan","Geeza Pro",serif;
    --text-ar:"Tahoma","Segoe UI","Arial",sans-serif;
    --display-fr:Georgia,"Times New Roman",serif;
    --text-fr:-apple-system,"Segoe UI",Helvetica,Arial,sans-serif;
  }
  *{box-sizing:border-box;margin:0;padding:0;}
  html{scroll-behavior:smooth;}
  body{
    background:var(--ink);
    color:var(--sand);
    font-family:var(--text-ar);
    overflow-x:hidden;
    position:relative;
  }
  body::before{
    content:"";
    position:fixed;inset:0;
    background-image:radial-gradient(circle at 1px 1px, rgba(236,226,204,.035) 1px, transparent 0);
    background-size:3px 3px;
    pointer-events:none;
    z-index:5;
    mix-blend-mode:overlay;
  }
  ::selection{background:var(--rust);color:var(--sand);}

  /* ---- scroll progress reel ---- */
  #reel{
    position:fixed;top:0;right:0;left:0;height:3px;
    background:linear-gradient(to left,var(--gold),var(--rust));
    transform-origin:right;
    transform:scaleX(0);
    z-index:100;
    transition:transform .05s linear;
  }

  /* ---- header ---- */
  header{
    position:fixed;top:0;right:0;left:0;z-index:50;
    display:flex;justify-content:space-between;align-items:center;
    padding:22px 6vw;
    backdrop-filter:blur(8px);
    background:linear-gradient(to bottom, rgba(10,13,12,.85), transparent);
  }
  .brand-mini{font-family:var(--display-ar);font-size:1.6rem;color:var(--gold-bright);letter-spacing:1px;}
  nav{display:flex;gap:32px;font-size:.8rem;letter-spacing:.5px;color:var(--sand-dim);}
  nav a{color:inherit;text-decoration:none;position:relative;}
  nav a:hover{color:var(--gold-bright);}
  .fr-tag{
    display:block;font-family:var(--text-fr);font-size:.6rem;color:var(--rust);
    text-transform:uppercase;letter-spacing:1.5px;margin-top:2px;
  }

  /* ---- hero ---- */
  .hero{
    min-height:100vh;
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    text-align:center;
    position:relative;
    padding:120px 6vw 60px;
    background:
      radial-gradient(ellipse at 50% 30%, rgba(168,64,43,.18), transparent 60%),
      radial-gradient(ellipse at 50% 80%, rgba(23,59,57,.35), transparent 65%),
      var(--ink);
  }
  .orbit-ring{
    position:absolute;
    width:min(70vw,720px);height:min(70vw,720px);
    border:1px solid rgba(201,154,68,.25);
    border-radius:50%;
    animation:spin 40s linear infinite;
  }
  .orbit-ring::after{
    content:"";position:absolute;
    width:10px;height:10px;border-radius:50%;
    background:var(--gold-bright);
    box-shadow:0 0 16px 4px rgba(231,192,111,.7);
    top:-5px;left:50%;transform:translateX(-50%);
  }
  .orbit-ring.two{
    width:min(50vw,520px);height:min(50vw,520px);
    border-color:rgba(168,64,43,.3);
    animation:spin 26s linear infinite reverse;
  }
  .orbit-ring.two::after{background:var(--rust);box-shadow:0 0 12px 3px rgba(168,64,43,.7);}
  @keyframes spin{to{transform:rotate(360deg);}}

  #hero-shift{will-change:transform;}
  .wordmark{
    font-family:var(--display-ar);
    font-size:clamp(5.5rem,20vw,13rem);
    line-height:1;
    color:var(--sand);
    background:linear-gradient(180deg,var(--gold-bright) 0%, var(--gold) 35%, var(--rust) 100%);
    -webkit-background-clip:text;background-clip:text;color:transparent;
    filter:drop-shadow(0 8px 30px rgba(0,0,0,.6));
    position:relative;z-index:2;
    letter-spacing:2px;
  }
  .kicker{
    font-family:var(--text-fr);font-size:.7rem;letter-spacing:4px;text-transform:uppercase;
    color:var(--rust);margin-bottom:18px;position:relative;z-index:2;
  }
  .tagline{
    margin-top:26px;font-size:1.15rem;color:var(--sand-dim);max-width:36em;
    position:relative;z-index:2;
  }
  .tagline .fr{
    display:block;margin-top:8px;font-family:var(--text-fr);font-size:.85rem;
    font-style:italic;color:var(--sand-dim);opacity:.75;
  }
  .invite-pill{
    margin-top:44px;display:inline-flex;align-items:center;gap:10px;
    border:1px solid var(--gold);border-radius:999px;
    padding:10px 26px;font-size:.85rem;color:var(--gold-bright);
    position:relative;z-index:2;
  }
  .invite-pill::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--rust);}

  /* ---- section shell ---- */
  section{padding:120px 6vw;position:relative;}
  .eyebrow{
    font-family:var(--text-fr);font-size:.7rem;letter-spacing:3px;text-transform:uppercase;
    color:var(--rust);margin-bottom:14px;
  }
  h2{
    font-family:var(--display-ar);font-size:clamp(2.2rem,5vw,3.6rem);
    color:var(--sand);font-weight:400;margin-bottom:18px;
  }
  h2 .fr-sub{
    display:block;font-family:var(--display-fr);font-size:1rem;color:var(--sand-dim);
    font-style:italic;margin-top:10px;letter-spacing:.5px;
  }
  [data-reveal]{
    opacity:0;transform:translateY(40px);
    transition:opacity .9s cubic-bezier(.2,.7,.2,1), transform .9s cubic-bezier(.2,.7,.2,1);
  }
  [data-reveal].in-view{opacity:1;transform:translateY(0);}

  /* ---- ticker ---- */
  .ticker-wrap{
    padding:34px 0;border-top:1px solid rgba(201,154,68,.2);border-bottom:1px solid rgba(201,154,68,.2);
    overflow:hidden;background:var(--night);
  }
  .ticker{display:flex;white-space:nowrap;width:max-content;animation:scroll-ticker 32s linear infinite;}
  .ticker span{
    font-family:var(--display-ar);font-size:1.9rem;color:var(--sand-dim);
    padding:0 2.2rem;display:inline-flex;align-items:center;gap:1.2rem;
  }
  .ticker span small{
    font-family:var(--text-fr);font-size:.6rem;letter-spacing:1px;color:var(--rust);
    text-transform:uppercase;
  }
  .ticker span::after{content:"◆";color:var(--gold);font-size:.7rem;margin-inline-start:1.2rem;}
  @keyframes scroll-ticker{from{transform:translateX(0);}to{transform:translateX(50%);}}

  /* ---- films grid ---- */
  .films-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:28px;margin-top:50px;}
  .film-card{
    background:linear-gradient(160deg,var(--night),var(--ink));
    border:1px solid rgba(201,154,68,.15);
    border-radius:2px;overflow:hidden;
    transition:transform .4s ease, border-color .4s ease;
  }
  .film-card:hover{transform:translateY(-6px);border-color:var(--gold);}
  .poster{
    height:280px;position:relative;
    display:flex;align-items:center;justify-content:center;
  }
  .poster span{font-family:var(--display-ar);font-size:3rem;color:rgba(236,226,204,.85);}
  .p1{background:linear-gradient(150deg,var(--rust),var(--ink) 75%);}
  .p2{background:linear-gradient(150deg,var(--teal),var(--ink) 75%);}
  .p3{background:linear-gradient(150deg,var(--gold-bright),var(--rust-dim) 65%,var(--ink) 100%);}
  .film-meta{padding:20px 22px 26px;}
  .film-meta h3{font-family:var(--display-ar);font-size:1.4rem;color:var(--sand);font-weight:400;}
  .film-meta .fr-line{
    font-family:var(--text-fr);font-size:.75rem;color:var(--sand-dim);margin-top:6px;
    letter-spacing:.3px;
  }
  .film-meta .yr{font-size:.72rem;color:var(--rust);margin-top:10px;letter-spacing:1px;}

  /* ---- manifesto ---- */
  .manifesto{
    text-align:center;background:radial-gradient(circle at 50% 50%,rgba(23,59,57,.4),transparent 70%);
  }
  .manifesto p{
    font-family:var(--display-ar);font-size:clamp(1.6rem,3.4vw,2.6rem);
    line-height:1.9;max-width:22em;margin:0 auto;color:var(--sand);
  }
  .manifesto .fr-line{
    margin-top:26px;font-family:var(--display-fr);font-style:italic;font-size:1rem;
    color:var(--sand-dim);
  }

  /* ---- invite form ---- */
  .invite-section{
    background:var(--night);border-top:1px solid rgba(201,154,68,.2);text-align:center;
  }
  form{
    margin-top:40px;display:flex;gap:12px;justify-content:center;flex-wrap:wrap;
  }
  input[type=email]{
    background:transparent;border:1px solid var(--sand-dim);color:var(--sand);
    padding:14px 18px;font-size:.95rem;min-width:280px;font-family:var(--text-fr);
    border-radius:1px;
  }
  input[type=email]::placeholder{color:var(--sand-dim);}
  input[type=email]:focus{outline:none;border-color:var(--gold);}
  button{
    background:var(--rust);color:var(--sand);border:none;padding:14px 30px;
    font-family:var(--text-ar);font-size:.95rem;cursor:pointer;letter-spacing:.5px;
    transition:background .3s ease;
  }
  button:hover{background:var(--gold);color:var(--ink);}

  footer{
    padding:60px 6vw 40px;display:flex;justify-content:space-between;align-items:center;
    flex-wrap:wrap;gap:20px;border-top:1px solid rgba(201,154,68,.12);
    font-size:.75rem;color:var(--sand-dim);
  }
  footer .fr-line{font-family:var(--text-fr);}

  @media(max-width:640px){
    nav{display:none;}
    form{flex-direction:column;align-items:center;}
    input[type=email]{width:100%;}
  }
</style>
</head>
<body>

<div id="reel"></div>

<header>
  <div class="brand-mini">مدار</div>
  <nav>
    <a href="#films">الأفلام<span class="fr-tag">Films</span></a>
    <a href="#manifesto">الفكرة<span class="fr-tag">Concept</span></a>
    <a href="#invite">العضوية<span class="fr-tag">Adhésion</span></a>
  </nav>
</header>

<section class="hero">
  <div class="orbit-ring"></div>
  <div class="orbit-ring two"></div>
  <div id="hero-shift">
    <p class="kicker">Cinéma arabe · Sur invitation seulement</p>
    <h1 class="wordmark">مدار</h1>
    <p class="tagline">
      منصّة سينمائية عربية، مغلقة على من يُدعى إليها فقط. كل فيلم مدار يدور حول حكاية لا تتكرر.
      <span class="fr">Une orbite de films arabes rares, accessible uniquement par invitation.</span>
    </p>
  </div>
  <div class="invite-pill">دعوة فقط <span style="opacity:.6">— Invitation only</span></div>
</section>

<div class="ticker-wrap">
  <div class="ticker" id="ticker">
    <span>باب الحديد <small>Le Caire · 1958</small></span>
    <span>عرس الجليل <small>Palestine · 1987</small></span>
    <span>وقائع سنين الجمر <small>Algérie · 1975</small></span>
    <span>الرسالة <small>Libye · 1976</small></span>
    <span>عصفور <small>Beyrouth · 2019</small></span>
    <span>باب الحديد <small>Le Caire · 1958</small></span>
    <span>عرس الجليل <small>Palestine · 1987</small></span>
    <span>وقائع سنين الجمر <small>Algérie · 1975</small></span>
    <span>الرسالة <small>Libye · 1976</small></span>
    <span>عصفور <small>Beyrouth · 2019</small></span>
  </div>
</div>

<section id="films">
  <div data-reveal>
    <p class="eyebrow">Sélection du mois</p>
    <h2>قوائم مختارة<span class="fr-sub">Sélections choisies avec soin, pas d'algorithme.</span></h2>
  </div>
  <div class="films-grid">
    <article class="film-card" data-reveal>
      <div class="poster p1"><span>ظل</span></div>
      <div class="film-meta">
        <h3>الظل الطويل</h3>
        <p class="fr-line">L'Ombre longue — un huis clos à Damas</p>
        <p class="yr">دمشق · ١٩٩٤</p>
      </div>
    </article>
    <article class="film-card" data-reveal>
      <div class="poster p2"><span>بحر</span></div>
      <div class="film-meta">
        <h3>البحر أمامكم</h3>
        <p class="fr-line">La mer devant vous — chronique de Beyrouth</p>
        <p class="yr">بيروت · ٢٠٠٨</p>
      </div>
    </article>
    <article class="film-card" data-reveal>
      <div class="poster p3"><span>رمل</span></div>
      <div class="film-meta">
        <h3>مدينة الرمل</h3>
        <p class="fr-line">La cité de sable — road movie du Hedjaz</p>
        <p class="yr">الحجاز · ١٩٧٢</p>
      </div>
    </article>
  </div>
</section>

<section id="manifesto" class="manifesto" data-reveal>
  <p>لسنا مكتبة، نحن مدار. كل عضو يدور حول اختيار واحد شهريًا، لا قائمة تُشتّت النظر.</p>
  <p class="fr-line">Nous ne sommes pas une bibliothèque. Nous sommes une orbite — un seul choix par mois, rien de plus.</p>
</section>

<section id="invite" class="invite-section" data-reveal>
  <p class="eyebrow">Demande d'accès</p>
  <h2>اطلب دعوتك<span class="fr-sub">Chaque saison, un nombre limité de places s'ouvre.</span></h2>
  <form onsubmit="return handleInvite(event)">
    <input type="email" placeholder="بريدك الإلكتروني · votre e-mail" required>
    <button type="submit">أرسل الطلب</button>
  </form>
  <p id="invite-msg" style="margin-top:18px;font-size:.8rem;color:var(--gold);min-height:1em;"></p>
</section>

<footer>
  <div>مدار © ٢٠٢٦ — جميع الحقوق محفوظة<span class="fr-line" style="display:block;opacity:.7;">MADAR — Tous droits réservés</span></div>
  <div class="fr-line">Fait pour être vu dans le noir.</div>
</footer>

<script>
  // ---- 1. scroll-driven hero parallax + progress reel ----
  var hero = document.getElementById('hero-shift');
  var reel = document.getElementById('reel');
  var heroSection = document.querySelector('.hero');

  function onScroll(){
    var y = window.scrollY;
    var vh = window.innerHeight;

    // hero parallax: wordmark drifts up and fades as user scrolls past hero
    var progressInHero = Math.min(y / (vh * 0.9), 1);
    var translate = progressInHero * 90;
    var scale = 1 - progressInHero * 0.12;
    var opacity = 1 - progressInHero * 0.9;
    hero.style.transform = 'translateY(' + (-translate) + 'px) scale(' + scale + ')';
    hero.style.opacity = opacity;

    // orbit rings rotate slightly faster with scroll for a "pulled into orbit" feel
    var rings = heroSection.querySelectorAll('.orbit-ring');
    rings.forEach(function(r, i){
      r.style.transform = 'rotate(' + (y * (i === 0 ? 0.05 : -0.08)) + 'deg)';
    });

    // scroll progress reel across full document
    var docHeight = document.documentElement.scrollHeight - window.innerHeight;
    var pct = docHeight > 0 ? y / docHeight : 0;
    reel.style.transform = 'scaleX(' + pct + ')';
  }
  window.addEventListener('scroll', onScroll, {passive:true});
  onScroll();

  // ---- 2. IntersectionObserver reveal choreography ----
  var revealEls = document.querySelectorAll('[data-reveal]');
  var io = new IntersectionObserver(function(entries){
    entries.forEach(function(entry, idx){
      if(entry.isIntersecting){
        var el = entry.target;
        var delay = Array.prototype.indexOf.call(revealEls, el) % 3 * 120;
        setTimeout(function(){ el.classList.add('in-view'); }, delay);
        io.unobserve(el);
      }
    });
  }, {threshold:0.15});
  revealEls.forEach(function(el){ io.observe(el); });

  // ---- invite form (no backend, static demo) ----
  function handleInvite(e){
    e.preventDefault();
    var msg = document.getElementById('invite-msg');
    msg.textContent = 'تم تسجيل طلبك — سنتواصل عند توفر مكان. / Votre demande a été enregistrée.';
    e.target.reset();
    return false;
  }
</script>

</body>
</html>
```

DESIGN RATIONALE:
مدار (madār — "orbit") frames the brand as a closed, gravitational system: one curated film pulls members into its pull each month, rather than an endless catalog competing for attention. The rotating orbit rings behind the wordmark, the reel-style scroll-progress bar, and the parallax hero all literalize that orbital, film-projector motion instead of using generic fade-ins. The palette — near-black ink, rust-red, and warm gold with a single deep-teal accent — evokes desert night and film-noir tungsten light rather than the default gray-and-purple SaaS look. I deliberately did NOT add autoplaying video/audio, a working backend, real film stills, icon fonts, or any external font/CDN — everything is system-font stacks and CSS/SVG-free shapes, keeping the file honest as a single portable artifact. I also did not attempt a full streaming catalog UI (search, filters, player chrome) since the brief asked for a landing page, not a product shell.
