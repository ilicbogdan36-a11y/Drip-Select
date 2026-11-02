/* Engleski prevod sajta. Učitava se tek kad posetilac izabere EN; srpski je podrazumevan.
   Radi tako što prevodi tekst na stranici (rečnik + šabloni), a SR vraća originalni tekst. */
(function () {
  "use strict";

  // ---- tačni tekstovi
  var D = {
    // meni, podnožje
    "Proizvodi": "Products", "O nama": "About us", "Česta pitanja": "FAQ", "Kontakt": "Contact",
    "Naruči po želji": "Request an item", "Korpa": "Cart", "Drip Select početna": "Drip Select home",
    "Plaćanje pouzećem • 100% originali": "Cash on delivery • 100% original", "Resetuj demo": "Reset demo",
    "Prodavnica": "Shop", "Informacije": "Information", "Odgovaramo u roku od 24 sata": "We reply within 24 hours",
    // početna
    "Povoljno. Kvalitetno. Na jednom mestu.": "Affordable. Quality. All in one place.",
    "Poznati brendovi i pažljivo biran izbor po pristupačnim cenama.": "Well-known brands and a carefully chosen selection at affordable prices.",
    "Pogledaj proizvode": "View products",
    "Kolekcija #01": "Collection #01", "Trenutno na stanju": "Currently in stock",
    "Pretraži proizvode...": "Search products...", "Pretraga": "Search",
    "Ne nalaziš ono što tražiš?": "Can't find what you're looking for?",
    "Pošalji sliku proizvoda koji želiš, a mi ga potražimo za tebe.": "Send a photo of the item you want and we'll look for it for you.",
    "Brend": "Brand", "Veličina": "Size", "Boja": "Color",
    "Cena": "Price", "Naruči": "Order", "Dodaj u korpu": "Add to cart", "Rasprodato": "Sold out",
    "Nema rezultata.": "No results.", "Poništi filtere": "Clear filters",
    "Izdvajamo": "Featured", "Najbolje u kolekciji": "Best in the collection",
    "Novi drop uskoro": "New drop coming soon", "Meni": "Menu", "Najbrže nas stigneš na Instagramu": "The fastest way to reach us is Instagram", "Poruke na Instagramu gledamo prvo, pre mejla.": "We check Instagram messages first, before email.", "Otvori Instagram": "Open Instagram",
    "Status porudžbine i pitanja": "Order status and questions", "Piši nam u poruke na Instagramu, tamo odgovaramo najbrže.": "Message us on Instagram, that's where we reply fastest.",
    "Kako da proverim status porudžbine?": "How can I check my order status?", "Pošalji nam poruku na Instagramu, tamo odgovaramo najbrže.": "Send us a message on Instagram, that's where we reply fastest.",
    "Dostava u Srbiji je besplatna": "Delivery in Serbia is free", "Dostava van Srbije": "Delivery outside Serbia", "Dogovaramo posebno": "Arranged separately",
    "Dostavu van Srbije plaća kupac. Cenu ti javljamo pre slanja. Besplatna dostava važi samo u Srbiji.": "Delivery outside Serbia is paid by the customer. We'll tell you the price before shipping. Free delivery applies to Serbia only.", "Besplatno": "Free", "Dodaj još artikala": "Add more items",
    "Jedan mejl po dropu": "One email per drop", "Odjava u svakom mejlu": "Unsubscribe in every email",
    "Svi proizvodi su rasprodati. Upiši mejl i javljamo ti čim izađe novi drop.": "Everything is sold out. Enter your email and we'll let you know as soon as the new drop is out.",
    "tvoj@mejl.rs": "your@email.com", "Mejl": "Email", "Obavesti me": "Notify me",
    "Hvala! Javljamo ti se čim izađe novi drop.": "Thanks! We'll let you know as soon as the new drop is out.",
    "Slanje nije uspelo, pokušaj ponovo.": "Sending failed, please try again.",
    "Učitavanje...": "Loading...",
    // proizvod
    "← Nazad na proizvode": "← Back to products",
    "Ovaj proizvod je već prodat.": "This item has already been sold.",
    "Dostupan je samo jedan primerak.": "Only one is available.",
    "Stanje": "Condition", "Nije na stanju": "Out of stock", "Naruči odmah": "Order now",
    "Dostava": "Delivery", "Dogovaramo pri potvrdi": "Arranged on confirmation",
    "Pouzećem": "Cash on delivery", "Plaćaš kuriru": "Pay the courier",
    "Povrat 14 dana": "14-day returns", "Bez pitanja": "No questions asked",
    "Opis": "Description", "Detalji proizvoda": "Product details", "Slični proizvodi": "Similar products",
    "Trenutno nema drugih proizvoda.": "No other products right now.",
    "Kategorija": "Category", "Autentičnost": "Authenticity",
    "Uvećaj sliku": "Enlarge image", "Umanji": "Zoom out", "Uvećaj": "Zoom in", "Prilagodi ekranu": "Fit to screen", "Galerija": "Gallery", "Prethodna": "Previous", "Sledeća": "Next", "Zatvori": "Close",
    "Stara cena": "Old price",
    "Odeća": "Clothing", "Jakne": "Jackets", "Duksevi": "Hoodies", "Obuća": "Footwear", "Majice": "T-shirts",
    "Pantalone": "Pants", "Trenerke": "Tracksuits", "Šorcevi": "Shorts", "Kape": "Hats", "Dodaci": "Accessories",
    // korpa i kasa
    "Ukloni": "Remove", "Na kasu": "Checkout", "Korpa je prazna.": "Your cart is empty.", "Nastavi kupovinu": "Continue shopping",
    "Početna": "Home", "Kasa": "Checkout",
    "Plaćanje pouzećem: popunite podatke i naručite. Pitanja? Piši nam na": "Cash on delivery: fill in your details and place your order. Questions? Write to us at",
    "Kontakt podaci": "Contact details", "Ime": "Name", "Prezime": "Last name", "Email": "Email", "Telefon": "Phone",
    "Adresa za isporuku": "Delivery address", "Ulica i broj": "Street and number", "Mejl koristimo samo za obaveštenje o novom dropu. Odjava je u svakom mejlu.": "We only use your email to notify you about new drops. You can unsubscribe in every email.", "Adresa": "Address", "Grad": "City", "Poštanski broj": "Postal code", "Država": "Country",
    "Napomena (opciono)": "Notes (optional)", "Napomena": "Notes",
    "Plaćanje": "Payment", "Pouzećem (gotovinom kuriru)": "Cash on delivery (pay the courier in cash)",
    "Plati gotovinom kuriru pri preuzimanju paketa.": "Pay the courier in cash when you receive your package.",
    "jedina opcija": "only option",
    "Tvoja narudžbina": "Your order", "Nema proizvoda u narudžbini.": "There are no items in your order.",
    "Nazad na proizvode": "Back to products", "Ukupno": "Total",
    "Dostavu dogovaramo pri potvrdi porudžbine.": "We arrange delivery when we confirm your order.",
    "Klikom na „Naruči“ prihvataš opšte uslove.": "By clicking “Order” you accept the terms and conditions.",
    "Slanje nije uspelo. Proveri internet pa pokušaj ponovo, a ako se ponovi, javi nam se preko strane Kontakt.": "Sending failed. Check your internet connection and try again, and if it keeps happening, contact us via the Contact page.",
    "Šaljem...": "Sending...", "Pokušaj ponovo": "Try again",
    "Hvala na porudžbini!": "Thank you for your order!", "Vrati se na proizvode": "Back to products",
    // o nama
    "← Nazad na sajt": "← Back to site",
    "Biramo samo ono što bismo i sami nosili, uvek originalno. Svaki proizvod dobija fotografije iz svih uglova, tačnu veličinu i ocenu stanja od 1 do 10, bez ulepšavanja.": "We only choose what we would wear ourselves, always original. Every item comes with photos from every angle, the exact size and a condition rating from 1 to 10, with no sugar-coating.",
    "Samo originali": "Only originals", "Prodajemo isključivo originalne proizvode.": "We sell genuine products only.",
    "Svaki proizvod je u jednom primerku": "Every item is one of one",
    "Nema ponovnog dopunjavanja: kad ga neko naruči, sklanjamo ga sa sajta.": "No restocking: once someone orders it, we take it off the site.",
    "Iskrena ocena stanja": "Honest condition rating", "Ako ima mane, pišemo ih i slikamo.": "If there are flaws, we write them down and photograph them.",
    // česta pitanja
    "Kako da naručim?": "How do I order?",
    "Otvori artikal i klikni „Naruči odmah“ ili ga dodaj u korpu. Na kasi upišeš kontakt i adresu, a mi te pozovemo radi potvrde.": "Open an item and click “Order now” or add it to your cart. At checkout you enter your contact details and address, and we call you to confirm.",
    "Da li su svi proizvodi originalni?": "Are all items original?",
    "Da. Prodajemo isključivo originalne proizvode.": "Yes. We sell genuine products only.",
    "Kako se plaća?": "How do I pay?",
    "Pouzećem, gotovinom kuriru pri preuzimanju paketa. Unapred ne plaćaš ništa.": "Cash on delivery, paid to the courier when you receive your package. You pay nothing in advance.",
    "Mogu li da vratim proizvod?": "Can I return an item?",
    "Možeš, u roku od 14 dana, bez navođenja razloga. Proizvod mora da bude u stanju u kom je stigao.": "Yes, within 14 days, no reason needed. The item must be in the condition it arrived in.",
    "Kako ocenjujete stanje?": "How do you rate condition?",
    "Skalom od 1 do 10. Novo sa etiketom je 10/10, a sve manje opisujemo iskreno, sa slikama mana.": "On a scale from 1 to 10. New with tags is 10/10, and anything lower we describe honestly, with photos of any flaws.",
    "Nisi našao odgovor?": "Didn't find your answer?", "Piši nam": "Write to us",
    // kontakt
    "Imaš pitanje?": "Got a question?", "Piši nam, odgovaramo u roku od 24 sata.": "Write to us, we reply within 24 hours.",
    "Poruka": "Message", "Pošalji poruku": "Send message", "Ili nas nađi ovde": "Or find us here",
    "Odgovor": "Reply", "U roku od 24 sata, svaki dan": "Within 24 hours, every day",
    "Poruka je poslata": "Message sent", "Javljamo se u roku od 24 sata.": "We'll get back to you within 24 hours.",
    // naruči po želji
    "Pošalji nam sliku duksa, jakne, patika ili bilo kog proizvoda koji želiš, a mi ga potražimo za tebe.": "Send us a photo of a hoodie, jacket, sneakers or any item you want, and we'll look for it for you.",
    "Pošalješ sliku": "You send a photo", "i veličinu": "and your size",
    "Tražimo proizvod": "We find the item", "i javljamo cenu": "and tell you the price",
    "Potvrdiš": "You confirm", "i dogovaramo dostavu": "and we arrange delivery",
    "Šta tražiš?": "What are you looking for?", "npr. Nike Tech Fleece duks, siv": "e.g. Nike Tech Fleece hoodie, gray",
    "Budžet (din.)": "Budget (RSD)", "Slike proizvoda (do 4)": "Product photos (up to 4)",
    "Boja, model, stanje, rok...": "Color, model, condition, deadline...",
    "Pošalji zahtev": "Send request", "Zahtev je poslat": "Request sent",
    "Javljamo ti se sa cenom čim nađemo proizvod.": "We'll get back to you with a price as soon as we find the item.",
    // naslov i opis stranice
    "Drip Select – Sve na jednom mestu": "Drip Select – Everything in one place"
  };

  // ---- šabloni sa vrednostima unutra
  var PAT = [
    [/^Besplatna dostava u Srbiji na (\d+) (?:artikal|artikla|artikala)$/, function (m, n) { return "Free delivery in Serbia on " + n + (n === "1" ? " item" : " items"); }],
    [/^Dodaj još (\d+) (?:artikal|artikla|artikala) i dostava je besplatna$/, function (m, n) { return "Add " + n + " more " + (n === "1" ? "item" : "items") + " for free delivery"; }],
    [/^Dostava: (.+)$/, function (m, p) { return "Delivery: " + (p === "besplatna" ? "free" : p); }],
    [/^Ukupno: (.+)$/, function (m, p) { return "Total: " + p; }],
    [/^Hvala, (.+)! Javljamo se na telefon radi potvrde, a zatim dogovaramo dostavu\.$/, function (m, n) { return "Thank you, " + n + "! We'll call you to confirm and then arrange delivery."; }],
    [/^Cena artikala \(plaćanje pouzećem\): (.+)$/, function (m, p) { return "Item total (cash on delivery): " + p; }],
    [/^Nažalost, više nije na stanju: (.+)\.$/, function (m, n) { return "Sorry, this is no longer available: " + n + "."; }],
    [/^Korpa \((\d+)\)$/, function (m, n) { return "Cart (" + n + ")"; }],
    [/^(\d+)\/(\d+) unikatni drip$/, function (m, a, b) { return a + "/" + b + " unique items"; }],
    [/^(\d+) \/ (\d+) proizvoda$/, function (m, a, b) { return a + " / " + b + " products"; }],
    [/^Naruči - (.+)$/, function (m, p) { return "Order - " + p; }],
    [/^Slika (\d+)$/, function (m, n) { return "Image " + n; }],
    [/^Stanje: (.+)$/, function (m, v) { return "Condition: " + v; }],
    [/^Stanje (.+)$/, function (m, v) { return "Condition " + v; }],
    [/^Vel\. (.+)$/, function (m, v) { return "Size " + v; }],
    [/^VEL: (.+)$/, function (m, v) { return "SIZE: " + v; }],
    [/^(.+) \*$/, function (m, inner) {
      var r = core(inner); if (r == null) r = inner;
      if (inner === "Ime" && CUR && CUR.parentNode && CUR.parentNode.htmlFor === "fn") r = "First name";
      return r + " *";
    }],
    [/^(.+) \(nije obavezno\)$/, function (m, inner) { var r = core(inner); return (r == null ? inner : r) + " (optional)"; }]
  ];

  // ---- boje (iz admina): samo ako je SVAKA reč poznata boja
  var STEMS = [["crn", "Black"], ["bel", "White"], ["siv", "Gray"], ["plav", "Blue"], ["crven", "Red"], ["zelen", "Green"], ["zut", "Yellow"],
    ["narandzast", "Orange"], ["ljubicast", "Purple"], ["zlatn", "Gold"], ["srebrn", "Silver"], ["maslinast", "Olive"], ["ruzicast", "Pink"], ["tirkizn", "Turquoise"]];
  var EXACT = { teget: "Navy", bordo: "Burgundy", bez: "Beige", krem: "Cream", roze: "Pink", roza: "Pink", braon: "Brown", smeda: "Brown", smedja: "Brown", smed: "Brown", khaki: "Khaki", haki: "Khaki", i: "and" };
  function colorWord(w) {
    if (EXACT.hasOwnProperty(w)) return EXACT[w];
    for (var i = 0; i < STEMS.length; i++) {
      var s = STEMS[i][0];
      if (w.indexOf(s) === 0 && /^[aoieu]?$/.test(w.slice(s.length))) return STEMS[i][1];
    }
    return null;
  }
  function color(c) {
    if (c.length > 40 || /\d/.test(c)) return null;
    var t = c.replace(/(svetlo|tamno)\s+/gi, "$1");
    var low = t.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "dj");
    var parts = low.split(/([\s\-\/,+]+)/), out = [], i, w, m, mod, name, any = false;
    for (i = 0; i < parts.length; i++) {
      w = parts[i];
      if (i % 2) { out.push(parts[i]); continue; }
      if (!w) { out.push(""); continue; }
      mod = ""; m = w.match(/^(svetlo|tamno)(.+)$/);
      if (m) { mod = m[1] === "svetlo" ? "Light " : "Dark "; w = m[2]; }
      name = colorWord(w);
      if (name == null) return null;
      if (name !== "and") any = true;
      out.push(mod + (mod && name !== "and" ? name.toLowerCase() : name));
    }
    return any ? out.join("") : null;
  }

  // ---- cena: "21.000 din." -> "21,000 RSD"
  function cur(s) {
    return s.replace(/(\d{1,3}(?:\.\d{3})+|\d+) din\./g, function (m, n) { return n.replace(/\./g, ",") + " RSD"; });
  }

  var CUR = null;
  function core(c) {
    var r = null, i, m;
    if (Object.prototype.hasOwnProperty.call(D, c)) r = D[c];
    else {
      for (i = 0; i < PAT.length; i++) {
        m = c.match(PAT[i][0]);
        if (m) { r = PAT[i][1].apply(null, m); break; }
      }
      if (r == null && c.indexOf(" · ") > -1) {
        var ps = c.split(" · "), ch = false;
        ps = ps.map(function (x) { var y = core(x); if (y != null) { ch = true; return y; } return x; });
        if (ch) r = ps.join(" · ");
      }
      if (r == null) r = color(c);
    }
    var x2 = cur(r != null ? r : c);
    return x2 === c ? null : x2;
  }
  function tr(s) {
    var m = s.match(/^(\s*)([\s\S]*?)(\s*)$/);
    if (!m[2]) return s;
    var out = core(m[2].replace(/\s+/g, " "));
    return out == null ? s : m[1] + out + m[3];
  }

  // ---- primena na stranicu
  var ORIG = new Map(), AORIG = new Map(), ATTRS = ["placeholder", "aria-label", "title", "alt"], mo = null, saved = null;

  function txt(n) {
    var v = n.nodeValue;
    if (!v || !/\S/.test(v)) return;
    CUR = n;
    var t = tr(v);
    CUR = null;
    if (t !== v) { ORIG.set(n, v); n.nodeValue = t; }
  }
  function attrs(el) {
    for (var i = 0; i < ATTRS.length; i++) {
      var a = ATTRS[i];
      if (!el.hasAttribute(a)) continue;
      var v = el.getAttribute(a), t = tr(v);
      if (t !== v) {
        var o = AORIG.get(el); if (!o) { o = {}; AORIG.set(el, o); }
        o[a] = v; el.setAttribute(a, t);
      }
    }
  }
  function walk(n) {
    if (n.nodeType === 3) return txt(n);
    if (n.nodeType !== 1) return;
    var tg = n.tagName;
    if (tg === "SCRIPT" || tg === "STYLE" || tg === "CANVAS") return;
    attrs(n);
    for (var c = n.firstChild; c; c = c.nextSibling) walk(c);
  }
  function gc() {
    if (ORIG.size < 4000) return;
    ORIG.forEach(function (v, n) { if (!n.isConnected) ORIG.delete(n); });
  }
  function meta(sel, attr, val) {
    var e = document.querySelector(sel);
    if (e) e.setAttribute(attr, val);
  }

  function on() {
    if (mo) return;
    saved = { title: document.title, desc: (document.querySelector('meta[name="description"]') || {}).content, lang: document.documentElement.lang };
    document.documentElement.lang = "en";
    document.title = tr(saved.title);
    if (saved.desc) meta('meta[name="description"]', "content", tr(saved.desc));
    walk(document.body);
    mo = new MutationObserver(function (recs) {
      for (var i = 0; i < recs.length; i++) {
        var r = recs[i];
        if (r.type === "childList") { for (var j = 0; j < r.addedNodes.length; j++) walk(r.addedNodes[j]); }
        else if (r.type === "characterData") txt(r.target);
      }
      gc();
    });
    mo.observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  function off() {
    if (!mo) return;
    mo.disconnect(); mo = null;
    ORIG.forEach(function (v, n) { if (n.isConnected) n.nodeValue = v; });
    ORIG.clear();
    AORIG.forEach(function (o, el) { for (var a in o) if (o.hasOwnProperty(a)) el.setAttribute(a, o[a]); });
    AORIG.clear();
    if (saved) {
      document.title = saved.title;
      if (saved.desc) meta('meta[name="description"]', "content", saved.desc);
      document.documentElement.lang = saved.lang || "sr";
    }
  }

  window.DSI18N = { on: on, off: off, tr: tr };
})();
