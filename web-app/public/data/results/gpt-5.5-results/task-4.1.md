<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>MADAR — مدار</title>
  <meta name="description" content="MADAR is a fictional invite-only Arabic cinema streaming service.">
  <style>
    :root {
      color-scheme: dark;
      --display-face: "Aptos Display", "Segoe UI Variable Display", "Dubai", "Noto Kufi Arabic", "Tahoma", sans-serif;
      --text-face: "Segoe UI Variable Text", "Segoe UI", "Noto Sans Arabic", "Tahoma", Arial, sans-serif;
      --latin-face: "Iowan Old Style", Georgia, "Times New Roman", serif;
      --night: #050706;
      --petrol: #071917;
      --petrol-2: #0f302d;
      --oxide: #2e7567;
      --saffron: #d6a449;
      --vermilion: #b8422e;
      --blood: #641f1d;
      --bone: #f1dfc0;
      --muted: #bfae8c;
      --line: rgba(241, 223, 192, .18);
      --shadow: rgba(0, 0, 0, .72);
      --page-progress: 0%;
      --mark-y: 0px;
      --mark-scale: 1;
      --orbit: 0deg;
      --pulse: .5;
      --shine-x: 50%;
      --reel-x: 0px;
      font-family: var(--text-face);
      letter-spacing: 0;
    }

    * { box-sizing: border-box; }
    html { scroll-behavior: smooth; background: var(--night); }
    body {
      margin: 0;
      min-height: 100%;
      direction: rtl;
      color: var(--bone);
      background:
        radial-gradient(circle at 12% 8%, rgba(46, 117, 103, .28), transparent 30rem),
        radial-gradient(circle at 84% 18%, rgba(184, 66, 46, .22), transparent 28rem),
        linear-gradient(145deg, #030403 0%, var(--petrol) 45%, #100806 100%);
      font-family: var(--text-face);
      line-height: 1.7;
      overflow-x: hidden;
    }

    body::before,
    body::after {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      z-index: 40;
    }

    body::before {
      opacity: .09;
      mix-blend-mode: screen;
      background-image:
        repeating-linear-gradient(0deg, rgba(255,255,255,.13) 0 1px, transparent 1px 4px),
        radial-gradient(circle at 30% 20%, rgba(214,164,73,.35), transparent 1px),
        radial-gradient(circle at 70% 80%, rgba(241,223,192,.24), transparent 1px);
      background-size: 100% 4px, 17px 19px, 23px 29px;
      transform: translate3d(calc(var(--pulse) * 8px - 4px), 0, 0);
    }

    body::after {
      background:
        linear-gradient(90deg, rgba(0,0,0,.55), transparent 18%, transparent 82%, rgba(0,0,0,.55)),
        radial-gradient(circle at 50% 42%, transparent 0 34rem, rgba(0,0,0,.7) 72rem);
    }

    ::selection { background: var(--saffron); color: var(--night); }
    a { color: inherit; text-decoration: none; }
    button, input { font: inherit; letter-spacing: 0; }

    .fr,
    :lang(fr) {
      direction: ltr;
      unicode-bidi: isolate;
      font-family: var(--latin-face);
      font-style: italic;
    }

    .site-header {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 30;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      padding: 1rem max(1rem, 4vw);
      border-bottom: 1px solid transparent;
      transition: background .5s ease, border-color .5s ease, padding .5s ease;
    }

    .site-header::after {
      content: "";
      position: absolute;
      right: 0;
      bottom: -1px;
      height: 1px;
      width: var(--page-progress);
      background: linear-gradient(90deg, var(--oxide), var(--saffron), var(--vermilion));
    }

    .site-header.is-deep {
      padding-top: .65rem;
      padding-bottom: .65rem;
      background: rgba(5, 7, 6, .82);
      border-color: var(--line);
      backdrop-filter: blur(18px);
    }

    .brand-small {
      display: inline-flex;
      align-items: baseline;
      gap: .6rem;
      font-family: var(--display-face);
      font-weight: 850;
      font-size: 1.45rem;
      line-height: 1;
    }

    .brand-small span:last-child {
      color: var(--saffron);
      font-size: .72rem;
      font-family: var(--latin-face);
      font-style: italic;
      font-weight: 500;
    }

    .nav {
      display: flex;
      align-items: center;
      gap: .35rem;
      color: var(--muted);
      font-size: .9rem;
    }

    .nav a {
      padding: .45rem .7rem;
      border: 1px solid transparent;
      border-radius: 999px;
      transition: color .25s ease, border-color .25s ease, background .25s ease;
    }

    .nav a:hover,
    .nav a:focus-visible {
      color: var(--bone);
      border-color: rgba(214,164,73,.35);
      background: rgba(214,164,73,.06);
      outline: none;
    }

    .hero {
      position: relative;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 7rem max(1rem, 6vw) 4rem;
      overflow: hidden;
    }

    .hero::before {
      content: "";
      position: absolute;
      inset: 0;
      background:
        linear-gradient(90deg, rgba(214,164,73,.06) 1px, transparent 1px),
        linear-gradient(0deg, rgba(241,223,192,.04) 1px, transparent 1px);
      background-size: 6.25rem 6.25rem;
      mask-image: radial-gradient(circle at 50% 42%, black 0 28rem, transparent 46rem);
      opacity: .5;
    }

    .hero-stage {
      position: absolute;
      inset: 5rem max(1rem, 5vw) 2rem;
      border: 1px solid rgba(214,164,73,.16);
      border-radius: 4px;
      transform: translate3d(0, calc(var(--mark-y) * -.25), 0);
    }

    .hero-stage::before,
    .hero-stage::after {
      content: "";
      position: absolute;
      inset: 1.15rem;
      border: 1px solid rgba(46,117,103,.35);
      border-radius: 50%;
      transform: rotate(var(--orbit));
    }

    .hero-stage::after {
      inset: 2.9rem 12%;
      border-color: rgba(184,66,46,.34);
      transform: rotate(calc(var(--orbit) * -1));
    }

    .hero-copy {
      position: relative;
      z-index: 2;
      width: min(72rem, 100%);
      text-align: center;
      display: grid;
      justify-items: center;
      gap: 1.25rem;
    }

    .kicker {
      margin: 0;
      color: var(--saffron);
      font-size: .92rem;
      font-weight: 650;
      text-transform: none;
    }

    .kicker .fr {
      display: inline-block;
      margin-inline-start: .65rem;
      color: var(--muted);
      font-weight: 500;
    }

    .wordmark {
      position: relative;
      isolation: isolate;
      display: inline-grid;
      place-items: center;
      margin: .2rem 0 0;
      padding: .16em .18em .28em;
      font-family: var(--display-face);
      font-size: 6.4rem;
      font-weight: 950;
      line-height: .78;
      letter-spacing: 0;
      transform: translate3d(0, var(--mark-y), 0) scale(var(--mark-scale));
      transform-origin: center;
      will-change: transform;
    }

    .wordmark > span { grid-area: 1 / 1; }

    .word-shadow {
      color: rgba(0,0,0,.85);
      transform: translate3d(-.08em, .08em, 0);
      filter: blur(3px);
    }

    .word-stroke {
      color: transparent;
      -webkit-text-stroke: 1px rgba(214,164,73,.58);
      text-shadow: 0 0 22px rgba(214,164,73,.18);
      transform: translate3d(calc(var(--pulse) * 10px - 5px), 0, 0);
    }

    .word-fill {
      color: transparent;
      background:
        linear-gradient(100deg, var(--bone) 0%, #fff0cc 24%, var(--saffron) 39%, var(--vermilion) 52%, var(--bone) 70%);
      background-size: 240% 100%;
      background-position: var(--shine-x) 50%;
      -webkit-background-clip: text;
      background-clip: text;
      filter: drop-shadow(0 1.8rem 2.6rem var(--shadow));
    }

    .wordmark::before {
      content: "";
      position: absolute;
      inset: 18% 0 25%;
      border: 1px solid rgba(46,117,103,.78);
      border-right-color: transparent;
      border-left-color: rgba(214,164,73,.55);
      border-radius: 50%;
      transform: rotate(var(--orbit));
      z-index: -1;
      box-shadow: 0 0 42px rgba(46,117,103,.24);
    }

    .wordmark::after {
      content: "";
      position: absolute;
      right: 5%;
      left: 5%;
      top: 52%;
      height: 2px;
      background: linear-gradient(90deg, transparent, var(--saffron), transparent);
      opacity: .8;
      transform: translateY(calc(var(--pulse) * 14px - 7px));
      mix-blend-mode: screen;
    }

    .hero-line {
      margin: 0;
      max-width: 46rem;
      font-size: 1.45rem;
      font-weight: 500;
      line-height: 1.8;
      color: #f7e9cc;
    }

    .hero-line-fr {
      margin: -.45rem 0 0;
      max-width: 38rem;
      color: var(--muted);
      font-size: 1rem;
      line-height: 1.65;
      text-align: center;
    }

    .hero-actions {
      display: flex;
      flex-wrap: wrap;
      justify-content: center;
      gap: .75rem;
      margin-top: .5rem;
    }

    .button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 2.9rem;
      padding: .7rem 1.05rem;
      border-radius: 8px;
      border: 1px solid rgba(214,164,73,.46);
      background: linear-gradient(135deg, rgba(214,164,73,.2), rgba(184,66,46,.13));
      color: var(--bone);
      box-shadow: 0 1rem 2.4rem rgba(0,0,0,.28);
    }

    .button.secondary {
      border-color: rgba(46,117,103,.6);
      background: rgba(46,117,103,.12);
      color: #d7eadc;
    }

    .release-slate {
      position: absolute;
      z-index: 2;
      left: max(1rem, 5vw);
      bottom: 3rem;
      display: grid;
      gap: .25rem;
      text-align: left;
      direction: ltr;
      color: var(--muted);
      font-size: .78rem;
      font-family: var(--latin-face);
      font-style: italic;
    }

    .release-slate strong {
      color: var(--saffron);
      font-family: var(--text-face);
      font-style: normal;
      font-size: 1rem;
    }

    main { position: relative; z-index: 3; }
    .section {
      padding: 6rem max(1rem, 6vw);
      border-top: 1px solid var(--line);
    }

    .section-inner {
      width: min(74rem, 100%);
      margin-inline: auto;
    }

    .manifest {
      background:
        linear-gradient(180deg, rgba(7,25,23,.25), rgba(100,31,29,.16)),
        linear-gradient(90deg, transparent, rgba(214,164,73,.04), transparent);
    }

    .split {
      display: grid;
      grid-template-columns: 1.2fr .8fr;
      gap: 3rem;
      align-items: end;
    }

    .section-title {
      margin: 0;
      font-family: var(--display-face);
      font-weight: 850;
      font-size: 3rem;
      line-height: 1.16;
      color: var(--bone);
    }

    .lead {
      margin: 1.4rem 0 0;
      color: #dccaa7;
      font-size: 1.16rem;
    }

    .side-note {
      border-right: 2px solid var(--saffron);
      padding: 1rem 1.2rem 1rem 0;
      color: var(--muted);
      font-size: 1.02rem;
    }

    .side-note .fr {
      display: block;
      margin-top: .8rem;
      text-align: left;
      color: #cfbfa0;
    }

    .program {
      overflow: hidden;
      background:
        radial-gradient(circle at 85% 20%, rgba(46,117,103,.18), transparent 24rem),
        linear-gradient(180deg, rgba(5,7,6,.2), rgba(7,25,23,.34));
    }

    .section-head {
      display: flex;
      align-items: end;
      justify-content: space-between;
      gap: 2rem;
      margin-bottom: 2.4rem;
    }

    .section-head .section-title { max-width: 50rem; }
    .chapter-number {
      color: var(--saffron);
      font-family: var(--latin-face);
      font-style: italic;
      font-size: 2.8rem;
      line-height: 1;
    }

    .reel {
      margin-inline: calc(max(1rem, 6vw) * -1);
      padding: 0 max(1rem, 6vw);
      overflow: hidden;
    }

    .reel-track {
      display: grid;
      grid-template-columns: repeat(4, minmax(16rem, 1fr));
      gap: 1rem;
      min-width: min(78rem, 100%);
      transform: translate3d(var(--reel-x), 0, 0);
      will-change: transform;
    }

    .film-card {
      min-height: 28rem;
      border: 1px solid rgba(241,223,192,.15);
      border-radius: 4px;
      background: rgba(5,7,6,.42);
      overflow: hidden;
      box-shadow: 0 1.4rem 3rem rgba(0,0,0,.24);
    }

    .still {
      position: relative;
      aspect-ratio: 4 / 5;
      overflow: hidden;
      border-bottom: 1px solid rgba(241,223,192,.15);
    }

    .still::before,
    .still::after {
      content: "";
      position: absolute;
      inset: 0;
    }

    .still::after {
      background:
        linear-gradient(90deg, rgba(0,0,0,.62), transparent 24%, transparent 70%, rgba(0,0,0,.6)),
        repeating-linear-gradient(90deg, rgba(0,0,0,.35) 0 10px, transparent 10px 20px);
      mix-blend-mode: multiply;
      opacity: .75;
    }

    .still-1 { background: linear-gradient(180deg, #0c2523 0 38%, #51201b 39% 100%); }
    .still-1::before { background: radial-gradient(circle at 42% 38%, rgba(241,223,192,.9) 0 2px, transparent 3px), linear-gradient(145deg, transparent 0 42%, rgba(214,164,73,.45) 43% 48%, transparent 49%); }
    .still-2 { background: linear-gradient(180deg, #06100f 0 30%, #1e5d54 31% 58%, #090605 59%); }
    .still-2::before { background: linear-gradient(90deg, transparent 0 20%, rgba(241,223,192,.16) 21% 23%, transparent 24% 60%, rgba(184,66,46,.5) 61% 63%, transparent 64%); }
    .still-3 { background: radial-gradient(circle at 70% 22%, rgba(214,164,73,.7), transparent 7rem), linear-gradient(160deg, #140908, #772d22 48%, #071917); }
    .still-3::before { background: linear-gradient(0deg, rgba(5,7,6,.85) 0 18%, transparent 19%), repeating-linear-gradient(90deg, transparent 0 18%, rgba(5,7,6,.55) 18% 19%); }
    .still-4 { background: linear-gradient(180deg, #0e302b, #071917 48%, #180b08); }
    .still-4::before { background: radial-gradient(ellipse at 50% 52%, transparent 0 22%, rgba(214,164,73,.45) 23% 24%, transparent 25%), linear-gradient(90deg, transparent 0 46%, rgba(241,223,192,.32) 47% 49%, transparent 50%); }

    .frame-code {
      position: absolute;
      right: .75rem;
      top: .65rem;
      z-index: 2;
      color: var(--saffron);
      font-family: var(--latin-face);
      font-style: italic;
      font-size: .9rem;
    }

    .film-body { padding: 1rem; }
    .film-body h3 {
      margin: 0;
      font-family: var(--display-face);
      font-size: 1.65rem;
      line-height: 1.2;
      color: var(--bone);
    }

    .film-body p {
      margin: .65rem 0 0;
      color: #cdbb99;
      font-size: .95rem;
    }

    .film-body .fr {
      text-align: left;
      color: #aebfb6;
      line-height: 1.55;
    }

    .invite {
      background:
        linear-gradient(180deg, rgba(100,31,29,.12), rgba(7,25,23,.18)),
        radial-gradient(circle at 18% 80%, rgba(214,164,73,.14), transparent 22rem);
    }

    .invite-panel {
      display: grid;
      grid-template-columns: .9fr 1.1fr;
      gap: 3rem;
      align-items: center;
    }

    .rules {
      display: grid;
      gap: .75rem;
      margin-top: 1.4rem;
      padding: 0;
      list-style: none;
      counter-reset: item;
    }

    .rules li {
      counter-increment: item;
      display: grid;
      grid-template-columns: 2.3rem 1fr;
      gap: .8rem;
      align-items: start;
      color: #d9c8a6;
    }

    .rules li::before {
      content: counter(item, decimal-leading-zero);
      color: var(--saffron);
      font-family: var(--latin-face);
      font-style: italic;
    }

    .invite-form {
      border: 1px solid rgba(214,164,73,.22);
      border-radius: 6px;
      padding: 1.2rem;
      background: linear-gradient(145deg, rgba(5,7,6,.62), rgba(46,117,103,.12));
    }

    .invite-form label {
      display: block;
      margin-bottom: .75rem;
      color: var(--muted);
    }

    .field-row {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: .7rem;
    }

    input[type="email"] {
      width: 100%;
      min-height: 3rem;
      border: 1px solid rgba(241,223,192,.25);
      border-radius: 6px;
      padding: .75rem .9rem;
      color: var(--bone);
      background: rgba(3,4,3,.72);
      direction: ltr;
      text-align: left;
    }

    input[type="email"]:focus {
      outline: 2px solid rgba(214,164,73,.45);
      outline-offset: 2px;
    }

    .status {
      min-height: 1.7rem;
      margin: .85rem 0 0;
      color: #d8e5d7;
      font-size: .95rem;
    }

    .footer {
      position: relative;
      z-index: 3;
      display: flex;
      justify-content: space-between;
      gap: 1rem;
      padding: 2rem max(1rem, 6vw);
      border-top: 1px solid var(--line);
      color: var(--muted);
      background: rgba(3,4,3,.58);
    }

    .reveal {
      opacity: 0;
      transform: translate3d(0, 1.5rem, 0);
      transition: opacity .8s ease, transform .8s ease;
    }

    .reveal.in-view {
      opacity: 1;
      transform: translate3d(0, 0, 0);
    }

    @media (min-width: 700px) {
      .wordmark { font-size: 10rem; }
      .section-title { font-size: 4.3rem; }
      .hero-line { font-size: 1.75rem; }
    }

    @media (min-width: 1100px) {
      .wordmark { font-size: 15rem; }
      .section-title { font-size: 5.4rem; }
    }

    @media (max-width: 820px) {
      .nav { display: none; }
      .hero { min-height: 92vh; padding-top: 6rem; }
      .hero-stage { inset: 5.25rem 1rem 2rem; }
      .release-slate { position: relative; left: auto; bottom: auto; margin-top: 1.5rem; }
      .split, .invite-panel { grid-template-columns: 1fr; gap: 2rem; }
      .section-head { display: block; }
      .chapter-number { margin-top: 1rem; font-size: 2rem; }
      .reel { overflow-x: auto; padding-bottom: 1rem; }
      .reel-track { grid-template-columns: repeat(4, 17rem); width: max-content; transform: none; }
      .field-row { grid-template-columns: 1fr; }
      .footer { display: grid; }
    }

    @media (max-width: 430px) {
      .wordmark { font-size: 5.2rem; }
      .hero-line { font-size: 1.18rem; }
      .section { padding-top: 4.5rem; padding-bottom: 4.5rem; }
      .section-title { font-size: 2.35rem; }
      .button { width: 100%; }
    }

    @media (prefers-reduced-motion: reduce) {
      *, *::before, *::after { animation-duration: .001ms !important; transition-duration: .001ms !important; scroll-behavior: auto !important; }
      .wordmark, .reel-track, .hero-stage { transform: none !important; }
    }
  </style>
</head>
<body>
  <header class="site-header" id="topbar">
    <a href="#top" class="brand-small" aria-label="MADAR home"><span>مدار</span><span lang="fr" dir="ltr">MADAR</span></a>
    <nav class="nav" aria-label="الملاحة الرئيسية">
      <a href="#manifest">الفكرة <span class="fr" lang="fr" dir="ltr">idée</span></a>
      <a href="#program">البرنامج <span class="fr" lang="fr" dir="ltr">films</span></a>
      <a href="#invite">الدعوة <span class="fr" lang="fr" dir="ltr">invitation</span></a>
    </nav>
  </header>

  <section class="hero" id="top" aria-labelledby="madar-title">
    <div class="hero-stage" aria-hidden="true"></div>
    <div class="hero-copy">
      <p class="kicker reveal">نادي مشاهدة عربي مغلق <span class="fr" lang="fr" dir="ltr">cinéma arabe sur invitation</span></p>
      <h1 class="wordmark" id="madar-title" aria-label="مدار">
        <span class="word-shadow" aria-hidden="true">مدار</span>
        <span class="word-stroke" aria-hidden="true">مدار</span>
        <span class="word-fill">مدار</span>
      </h1>
      <p class="hero-line reveal">أفلام عربية نادرة، ترميمات ليلية، وبرامج قصيرة تصل إلى دائرة صغيرة من المشاهدين.</p>
      <p class="hero-line-fr fr reveal" lang="fr" dir="ltr">Une salle obscure en ligne, programmée comme une cinémathèque: peu de titres, beaucoup de silence, aucune file infinie.</p>
      <div class="hero-actions reveal">
        <a class="button" href="#invite">اطلب مقعداً في المدار</a>
        <a class="button secondary" href="#program">شاهد برنامج الليلة</a>
      </div>
    </div>
    <aside class="release-slate" aria-label="Release slate">
      <strong>INVITE SEASON 01</strong>
      <span lang="fr" dir="ltr">quatre films / trente nuits</span>
      <span>بيروت · الدار البيضاء · القاهرة</span>
    </aside>
  </section>

  <main>
    <section class="section manifest" id="manifest">
      <div class="section-inner split">
        <div class="reveal">
          <p class="kicker">بيان قصير <span class="fr" lang="fr" dir="ltr">note de programmation</span></p>
          <h2 class="section-title">ليست منصة. إنها غرفة عرض تتحرك ببطء.</h2>
          <p class="lead">مدار لا يقيس السينما بعدد النقرات. كل شهر يدور حول محور واحد: مدينة، لهجة، أرشيف عائلي، أو ممثلة اختفت من الملصقات وبقي صوتها في الذاكرة.</p>
        </div>
        <div class="side-note reveal">
          <span>تفتح العروض عند منتصف الليل بتوقيت المدن العربية، وتبقى لثلاثين ليلة فقط. لا قوائم لا نهائية، لا تشغيل تلقائي، لا اختزال للفيلم إلى صورة مصغرة.</span>
          <span class="fr" lang="fr" dir="ltr">MADAR privilégie la rareté, la contextualisation et le rythme d'une vraie salle.</span>
        </div>
      </div>
    </section>

    <section class="section program" id="program">
      <div class="section-inner">
        <div class="section-head reveal">
          <div>
            <p class="kicker">برنامج هذا الأسبوع <span class="fr" lang="fr" dir="ltr">cette semaine</span></p>
            <h2 class="section-title">أفلام تدور حول الغياب، المدن، والضوء الأخير.</h2>
          </div>
          <div class="chapter-number" lang="fr" dir="ltr">04 / 30</div>
        </div>
      </div>
      <div class="reel" aria-label="قائمة أفلام مدار">
        <div class="reel-track">
          <article class="film-card reveal">
            <div class="still still-1"><span class="frame-code">01</span></div>
            <div class="film-body">
              <h3>باب الليل</h3>
              <p>رسائل من ميناء لا ينام، وامرأة تحفظ وجوه العابرين في دفتر أزرق.</p>
              <p class="fr" lang="fr" dir="ltr">Port nocturne, mémoire fragmentée, copie restaurée.</p>
            </div>
          </article>
          <article class="film-card reveal">
            <div class="still still-2"><span class="frame-code">02</span></div>
            <div class="film-body">
              <h3>سطح في تموز</h3>
              <p>كوميديا صامتة تقريباً عن عائلة تنتظر انقطاع الكهرباء كأنه موعد يومي.</p>
              <p class="fr" lang="fr" dir="ltr">Comédie sèche, chaleur urbaine, plans fixes.</p>
            </div>
          </article>
          <article class="film-card reveal">
            <div class="still still-3"><span class="frame-code">03</span></div>
            <div class="film-body">
              <h3>الظل الخامس</h3>
              <p>تحقيق بوليسي قصير، صوته أهم من صورته، صُوّر بين درجين ومقهى.</p>
              <p class="fr" lang="fr" dir="ltr">Polar de chambre, grain dense, voix au premier plan.</p>
            </div>
          </article>
          <article class="film-card reveal">
            <div class="still still-4"><span class="frame-code">04</span></div>
            <div class="film-body">
              <h3>مدار العودة</h3>
              <p>فيلم افتتاحي خاص عن أرشيفات العائلة حين تصبح خريطة للمنفى.</p>
              <p class="fr" lang="fr" dir="ltr">Essai intime, exil, images familiales recomposées.</p>
            </div>
          </article>
        </div>
      </div>
    </section>

    <section class="section invite" id="invite">
      <div class="section-inner invite-panel">
        <div class="reveal">
          <p class="kicker">الدخول بالدعوة <span class="fr" lang="fr" dir="ltr">sur cooptation</span></p>
          <h2 class="section-title">مقعد واحد، شاشة واحدة، شهر كامل.</h2>
          <ul class="rules">
            <li>كل دعوة تفتح أربعة أفلام ومقالين صوتيين ومحادثة مباشرة مع مبرمج الشهر.</li>
            <li>تنتقل الدعوات بين المشاهدين ببطء، مثل نسخة فيلم تمر من يد إلى يد.</li>
            <li>الواجهة تبدأ بالعربية، والفرنسية ترافقها كتعليق لا كواجهة بديلة.</li>
          </ul>
        </div>
        <form class="invite-form reveal" id="inviteForm">
          <label for="email">اترك بريداً للتنبيه عند فتح الدائرة التالية <span class="fr" lang="fr" dir="ltr">prochaine vague d'invitations</span></label>
          <div class="field-row">
            <input id="email" name="email" type="email" dir="ltr" autocomplete="email" placeholder="name@example.com" required>
            <button class="button" type="submit">تسجيل الاهتمام</button>
          </div>
          <p class="status" id="status" role="status" aria-live="polite"></p>
        </form>
      </div>
    </section>
  </main>

  <footer class="footer">
    <span>مدار · أرشيف خيالي للسينما العربية</span>
    <span class="fr" lang="fr" dir="ltr">fictional private streaming service, designed for one page</span>
  </footer>

  <script>
    (() => {
      const root = document.documentElement;
      const header = document.getElementById('topbar');
      const form = document.getElementById('inviteForm');
      const status = document.getElementById('status');
      const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      let latestY = window.scrollY;
      let pageProgress = 0;

      function setScrollVars() {
        latestY = window.scrollY;
        const max = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
        pageProgress = latestY / max;
        const heroProgress = Math.min(1, latestY / Math.max(420, window.innerHeight * .9));
        root.style.setProperty('--page-progress', `${(pageProgress * 100).toFixed(2)}%`);
        root.style.setProperty('--mark-y', `${(heroProgress * 42).toFixed(1)}px`);
        root.style.setProperty('--mark-scale', (1 - heroProgress * .07).toFixed(3));
        root.style.setProperty('--reel-x', `${(-pageProgress * 260).toFixed(1)}px`);
        header.classList.toggle('is-deep', latestY > 40);
      }

      function tick(time) {
        const pulse = (Math.sin(time / 1500) + 1) / 2;
        root.style.setProperty('--pulse', pulse.toFixed(3));
        root.style.setProperty('--shine-x', `${(18 + pulse * 72).toFixed(1)}%`);
        root.style.setProperty('--orbit', `${(-pageProgress * 92 + pulse * 14 - 7).toFixed(2)}deg`);
        requestAnimationFrame(tick);
      }

      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) entry.target.classList.add('in-view');
        });
      }, { threshold: .18 });

      document.querySelectorAll('.reveal').forEach((item) => observer.observe(item));
      window.addEventListener('scroll', setScrollVars, { passive: true });
      window.addEventListener('resize', setScrollVars);
      setScrollVars();
      if (!reduceMotion) requestAnimationFrame(tick);

      form.addEventListener('submit', (event) => {
        event.preventDefault();
        status.textContent = 'تم تسجيل اهتمامك. ستصلك إشارة قصيرة عندما يفتح المدار التالي.';
        form.reset();
      });
    })();
  </script>
</body>
</html>
<!-- DESIGN RATIONALE 1: Concept: MADAR is a private orbiting cinematheque; the Arabic wordmark behaves like a studio title card and navigational body. -->
<!-- DESIGN RATIONALE 2: Palette: petrol black, oxidized teal, saffron, vermilion, and bone replace neutral gray plus purple. -->
<!-- DESIGN RATIONALE 3: Typography: Arabic display scale leads; French is secondary and isolated LTR so bidi text never guesses. -->
<!-- DESIGN RATIONALE 4: Motion: scroll parallax, reel drift, reveal timing, and a breathing aperture are choreographed around cinema mechanics. -->
<!-- DESIGN RATIONALE 5: I deliberately avoided SaaS cards, purple gradients, Latin-first hierarchy, stock imagery, and confetti-like animation. -->
