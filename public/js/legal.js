/* ==========================================================================
   Legal view — /imprint and /privacy, in German and English.

   Why both, when the rest of the app is English only:

   § 5 DDG binds the *operator*, not the website's language. An operator based
   in Germany owes a German Impressum whatever language the site is written in,
   and German visitors are the ones the rule exists to protect — they look for
   the word "Impressum". So German is the authoritative text and always one
   click away, and English is a translation offered for everyone else. ("Legal
   Notice" is the right English term for it, by the way — "Imprint" is a false
   friend borrowed from print publishing.)

   The page opens in whichever language the visitor's browser asks for, and the
   toggle is remembered. Nothing is hidden behind a preference: both versions
   are on the same URL, one button apart.

   The operator's details live in /data/imprint.json rather than in this file,
   so the address can be filled in and changed without touching code. The
   unfinished state is deliberately loud — a half-filled Impressum is worse
   than none, because it looks compliant while failing § 5.
   ========================================================================== */

const REQUIRED = ['name', 'street', 'city', 'email'];
const LANG_KEY = 'vr.legalLang.v1';

let root = null;
let data = null;        // the parsed imprint file, or null if it never arrived
let lang = 'de';
let current = 'imprint';

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const missing = () => (data ? REQUIRED.filter((k) => !String(data[k] || '').trim()) : REQUIRED);

/* ------------------------------------------------------------------ data - */

async function loadImprint() {
  try {
    const res = await fetch('/data/imprint.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    console.warn('[legal] imprint data unavailable:', err.message);
    data = null;
  }
}

function initialLang() {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'de' || saved === 'en') return saved;
  } catch { /* private mode */ }
  return (navigator.language || 'de').toLowerCase().startsWith('de') ? 'de' : 'en';
}

function setLang(next) {
  lang = next;
  try { localStorage.setItem(LANG_KEY, next); } catch { /* private mode */ }
}

/* --------------------------------------------------------------- partials - */

const T = {
  de: {
    todoTitle: 'Diese Seite ist noch nicht fertig.',
    todoBody: (list) => `Die nach § 5 DDG erforderlichen Angaben fehlen: ${list}. Bitte in
      <code>public/data/imprint.json</code> eintragen und neu deployen. Bis dahin läuft diese
      Website ohne gültiges Impressum.`,
    other: 'Datenschutzerklärung',
    back: 'Zurück zur App',
    otherPrivacy: 'Impressum',
    switch: 'English',
  },
  en: {
    todoTitle: 'This page is not finished.',
    todoBody: (list) => `The operator details required by § 5 DDG are missing: ${list}. Fill them
      into <code>public/data/imprint.json</code> and redeploy. Until then this site is running
      without a valid legal notice.`,
    other: 'Privacy Policy',
    back: 'Back to the app',
    otherPrivacy: 'Legal Notice',
    switch: 'Deutsch',
  },
};

function unfinishedNotice() {
  const list = missing().map((k) => `<code>${esc(k)}</code>`).join(', ');
  return `
    <div class="legal__todo" role="alert">
      <b>${T[lang].todoTitle}</b>
      <p>${T[lang].todoBody(list)}</p>
    </div>`;
}

/** The operator block, shared by both documents and both languages. */
function operatorBlock() {
  const line = (v) => (String(v || '').trim() ? `${esc(v)}<br>` : '');
  const postal = [data.postalCode, data.city].filter(Boolean).join(' ');
  const country = lang === 'en' && /^deutschland$/i.test(String(data.country || ''))
    ? 'Germany'
    : data.country;
  return `
    <address class="legal__address">
      ${line(data.name)}${line(data.street)}${line(postal)}${line(country)}
    </address>
    <dl class="legal__contact">
      <dt>${lang === 'de' ? 'E-Mail' : 'Email'}</dt>
      <dd><a href="mailto:${esc(data.email)}">${esc(data.email)}</a></dd>
      ${String(data.phone || '').trim()
        ? `<dt>${lang === 'de' ? 'Telefon' : 'Phone'}</dt><dd>${esc(data.phone)}</dd>`
        : ''}
    </dl>`;
}

const block = (h, body) => `<section class="legal__block"><h2>${h}</h2>${body}</section>`;

/* ----------------------------------------------------- imprint, German --- */

function imprintDE() {
  const incomplete = missing().length > 0;
  return `
    <h1 class="legal__title">Impressum</h1>
    <p class="legal__lead">Angaben gemäß § 5 DDG.</p>

    ${incomplete ? unfinishedNotice() : `
      ${block('Diensteanbieter', operatorBlock())}

      ${String(data.responsible || '').trim() ? block('Redaktionell verantwortlich',
        `<p>Verantwortlich für journalistisch-redaktionelle Inhalte nach § 18 Abs. 2 MStV:
          ${esc(data.responsible)}, Anschrift wie oben.</p>`) : ''}

      ${block('Haftung für Inhalte', `
        <p>Die Inhalte dieser Seite wurden mit Sorgfalt erstellt. Für die Richtigkeit,
        Vollständigkeit und Aktualität der Inhalte kann jedoch keine Gewähr übernommen werden.
        Als Diensteanbieter bin ich gemäß § 7 Abs. 1 DDG für eigene Inhalte auf diesen Seiten
        nach den allgemeinen Gesetzen verantwortlich, nach §§ 8 bis 10 DDG jedoch nicht
        verpflichtet, übermittelte oder gespeicherte fremde Informationen zu überwachen oder nach
        Umständen zu forschen, die auf eine rechtswidrige Tätigkeit hinweisen.</p>`)}

      ${block('Haftung für Links', `
        <p>Dieses Angebot enthält Links zu externen Websites Dritter, auf deren Inhalte ich keinen
        Einfluss habe. Für diese fremden Inhalte ist stets der jeweilige Anbieter oder Betreiber
        der Seiten verantwortlich. Die verlinkten Seiten wurden zum Zeitpunkt der Verlinkung auf
        mögliche Rechtsverstöße überprüft; rechtswidrige Inhalte waren nicht erkennbar. Bei
        Bekanntwerden von Rechtsverletzungen werden derartige Links umgehend entfernt.</p>`)}

      ${block('Urheberrecht und Marken Dritter', `
        <p>Die von mir erstellten Inhalte und Werke auf diesen Seiten unterliegen dem deutschen
        Urheberrecht.</p>
        <p>Valorant sowie sämtliche Karten- und Agentenbezeichnungen, Artworks und Logos sind
        Eigentum von Riot Games, Inc. Dieses Angebot steht in keiner Verbindung zu Riot Games und
        wird von Riot Games weder unterstützt noch gesponsert. Die Darstellung erfolgt zu
        Informationszwecken im Rahmen eines nicht-kommerziellen Fanprojekts.</p>`)}

      ${block('Verbraucherstreitbeilegung', `
        <p>Ich bin nicht bereit und nicht verpflichtet, an Streitbeilegungsverfahren vor einer
        Verbraucherschlichtungsstelle teilzunehmen. Über diese Website werden keine Verträge
        geschlossen und keine Waren oder Dienstleistungen verkauft.</p>`)}
    `}`;
}

/* ---------------------------------------------------- imprint, English --- */

function imprintEN() {
  const incomplete = missing().length > 0;
  return `
    <h1 class="legal__title">Legal Notice</h1>
    <p class="legal__lead">Provider identification under § 5 DDG (German Digital Services Act).
      The German version is the authoritative one.</p>

    ${incomplete ? unfinishedNotice() : `
      ${block('Service provider', operatorBlock())}

      ${String(data.responsible || '').trim() ? block('Editorial responsibility',
        `<p>Responsible for journalistic and editorial content under § 18 (2) MStV:
          ${esc(data.responsible)}, at the address above.</p>`) : ''}

      ${block('Liability for content', `
        <p>The content of this site has been produced with care, but no guarantee is given as to
        its accuracy, completeness or timeliness. Under § 7 (1) DDG I am responsible for my own
        content on these pages under general law. Under §§ 8 to 10 DDG I am not obliged to monitor
        transmitted or stored third-party information, nor to investigate circumstances that
        suggest unlawful activity.</p>`)}

      ${block('Liability for links', `
        <p>This site links to external websites over whose content I have no influence. The
        respective provider or operator of those pages is always responsible for their content.
        The linked pages were checked for possible legal violations at the time of linking; no
        unlawful content was apparent. Such links will be removed promptly if a violation becomes
        known.</p>`)}

      ${block('Copyright and third-party trademarks', `
        <p>Content and works created by me on these pages are subject to German copyright law.</p>
        <p>Valorant, together with all map and agent names, artwork and logos, is the property of
        Riot Games, Inc. This site is not affiliated with, endorsed by or sponsored by Riot Games.
        The material is shown for informational purposes as part of a non-commercial fan
        project.</p>`)}

      ${block('Consumer dispute resolution', `
        <p>I am neither willing nor obliged to take part in dispute resolution proceedings before
        a consumer arbitration board. No contracts are concluded and nothing is sold through this
        website.</p>`)}
    `}`;
}

/* --------------------------------------------------- privacy, German ----- */

function privacyDE() {
  const incomplete = missing().length > 0;
  const updated = esc(data?.updated || '');
  return `
    <h1 class="legal__title">Datenschutzerklärung</h1>
    <p class="legal__lead">Informationen nach Art. 13 DSGVO. Diese Website setzt keine Cookies,
      verwendet keine Analyse-Dienste und zeigt keine Werbung.</p>

    ${block('1. Verantwortlicher', incomplete ? unfinishedNotice() : operatorBlock())}

    ${block('2. Kurzfassung', `
      <ul>
        <li>Keine Cookies, keine Analyse- oder Tracking-Dienste, keine Werbung.</li>
        <li>Kein Nutzerkonto, keine Registrierung.</li>
        <li>Ihre Einstellungen (gebannte Karten, Agenten-Board, Spielverlauf) werden
            ausschließlich lokal in Ihrem Browser gespeichert.</li>
        <li>Schriftarten werden von diesem Server ausgeliefert, nicht von Google Fonts.</li>
        <li>Ihre Riot-ID verlässt Ihren Browser nur, wenn Sie ein Spiel aktiv abschließen.</li>
      </ul>`)}

    ${block('3. Hosting und Server-Logfiles', `
      <p>Diese Website wird bei der Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723, USA
      gehostet. Beim Aufruf verarbeitet der Hoster automatisch Daten, die Ihr Browser übermittelt:
      IP-Adresse, Datum und Uhrzeit des Zugriffs, Name und URL der abgerufenen Datei, übertragene
      Datenmenge, Meldung über den Erfolg des Abrufs, Browsertyp und -version, Betriebssystem und
      gegebenenfalls die zuvor besuchte Seite.</p>
      <p>Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO; das berechtigte Interesse liegt in der
      technisch fehlerfreien Bereitstellung und der Sicherheit der Website. Eine Zusammenführung
      mit anderen Datenquellen findet nicht statt.</p>
      <p>Da der Hoster seinen Sitz in den USA hat, kann eine Übermittlung in ein Drittland
      stattfinden. Die Übermittlung wird auf die Standardvertragsklauseln der EU-Kommission
      gestützt; zusätzlich besteht ein Vertrag zur Auftragsverarbeitung nach Art. 28 DSGVO.</p>`)}

    ${block('4. Einbindung von valorant-api.com', `
      <p>Karten- und Agentendaten, Rang-Embleme und die zugehörigen Bilder werden beim Laden der
      Seite direkt von <a href="https://valorant-api.com" target="_blank"
      rel="noopener noreferrer">valorant-api.com</a> bzw. media.valorant-api.com abgerufen. Dabei
      wird Ihre IP-Adresse technisch bedingt an den Betreiber dieses Dienstes übertragen, da Ihr
      Browser die Anfrage selbst stellt.</p>
      <p>valorant-api.com ist ein inoffizielles Community-Projekt ohne Verbindung zu Riot Games.
      Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO; das berechtigte Interesse liegt darin,
      stets aktuelle Spieldaten anzuzeigen, ohne die Artworks selbst zu vervielfältigen.</p>`)}

    ${block('5. Abgleich von Matches (HenrikDev API)', `
      <p>Wenn — und nur wenn — Sie auf der Seite „Career“ ein Spiel über die Schaltfläche
      <i>Finalize</i> abschließen, sendet Ihr Browser die von Ihnen eingegebene Riot-ID (Name,
      Tag und Region) an diese Website. Von dort wird sie serverseitig an die
      <a href="https://docs.henrikdev.xyz" target="_blank" rel="noopener noreferrer">HenrikDev
      API</a> (api.henrikdev.xyz) weitergegeben, um Ihre letzten Matches abzurufen. Ihre
      IP-Adresse wird dabei <b>nicht</b> an diesen Dienst übertragen, da die Anfrage vom Server
      und nicht von Ihrem Browser gestellt wird.</p>
      <p>Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO; das berechtigte Interesse liegt in der
      von Ihnen angeforderten Funktion, ein gespieltes Custom Game den zuvor ausgelosten
      Einstellungen zuzuordnen. Es findet keine Speicherung der Riot-ID auf dem Server statt; die
      Ergebnisse werden ausschließlich in Ihrem Browser gespeichert. Die HenrikDev API ist ein
      inoffizielles Community-Projekt ohne Verbindung zu Riot Games. Wenn Sie diese Übermittlung
      nicht wünschen, nutzen Sie stattdessen die Schaltfläche <i>Enter Manually</i>.</p>`)}

    ${block('6. Lokale Speicherung im Browser', `
      <p>Die Anwendung speichert im <i>Local Storage</i> Ihres Browsers Ihre gebannten Karten, den
      Stand des Agenten-Boards, Ihre Einstellungen, Ihre Riot-ID und den Verlauf Ihrer Custom
      Games. Zusätzlich wird die zuletzt abgerufene Karten- und Agentenliste zwischengespeichert,
      damit die Anwendung auch ohne Verbindung zur API funktioniert.</p>
      <p>Diese Daten verbleiben auf Ihrem Gerät, werden nicht an mich übertragen und können
      jederzeit über die Einstellungen Ihres Browsers gelöscht werden. Da die Speicherung für die
      von Ihnen ausdrücklich gewünschte Funktion unbedingt erforderlich ist, ist sie nach
      § 25 Abs. 2 Nr. 2 TDDDG einwilligungsfrei.</p>`)}

    ${block('7. Kontaktaufnahme', `
      <p>Wenn Sie mich per E-Mail kontaktieren, verarbeite ich Ihre Angaben ausschließlich zur
      Bearbeitung Ihrer Anfrage. Rechtsgrundlage ist Art. 6 Abs. 1 lit. f DSGVO. Die Daten werden
      gelöscht, sobald die Anfrage erledigt ist und keine Aufbewahrungspflichten
      entgegenstehen.</p>`)}

    ${block('8. Ihre Rechte', `
      <p>Sie haben jederzeit das Recht auf Auskunft (Art. 15 DSGVO), Berichtigung (Art. 16),
      Löschung (Art. 17), Einschränkung der Verarbeitung (Art. 18) und Datenübertragbarkeit
      (Art. 20 DSGVO).</p>
      <p><b>Widerspruchsrecht:</b> Soweit die Verarbeitung auf Art. 6 Abs. 1 lit. f DSGVO beruht,
      haben Sie das Recht, aus Gründen, die sich aus Ihrer besonderen Situation ergeben, jederzeit
      Widerspruch einzulegen (Art. 21 DSGVO).</p>
      <p>Unabhängig davon steht Ihnen ein Beschwerderecht bei einer Datenschutz-Aufsichtsbehörde
      zu, insbesondere im Mitgliedstaat Ihres Aufenthaltsorts oder des mutmaßlichen
      Verstoßes.</p>`)}

    ${block('9. Stand', `
      <p>Diese Datenschutzerklärung hat den Stand ${updated || 'siehe Repository'}.</p>`)}`;
}

/* -------------------------------------------------- privacy, English ----- */

function privacyEN() {
  const incomplete = missing().length > 0;
  const updated = esc(data?.updated || '');
  return `
    <h1 class="legal__title">Privacy Policy</h1>
    <p class="legal__lead">Information under Art. 13 GDPR. This site sets no cookies, runs no
      analytics and shows no ads. The German version is the authoritative one.</p>

    ${block('1. Controller', incomplete ? unfinishedNotice() : operatorBlock())}

    ${block('2. In short', `
      <ul>
        <li>No cookies, no analytics or tracking, no advertising.</li>
        <li>No account and no registration.</li>
        <li>Your settings — banned maps, the agent board, your game log — are stored only in your
            own browser.</li>
        <li>Fonts are served from this server, not from Google Fonts.</li>
        <li>Your Riot ID leaves your browser only when you actively finalize a game.</li>
      </ul>`)}

    ${block('3. Hosting and server logs', `
      <p>This site is hosted by Vercel Inc., 440 N Barranca Ave #4133, Covina, CA 91723, USA. When
      you open a page the host automatically processes data your browser transmits: IP address,
      date and time of access, name and URL of the file requested, volume of data transferred,
      whether the request succeeded, browser type and version, operating system, and the
      previously visited page where applicable.</p>
      <p>The legal basis is Art. 6 (1) (f) GDPR; the legitimate interest is the technically
      correct and secure delivery of the website. This data is not combined with any other
      source.</p>
      <p>As the host is based in the USA, data may be transferred to a third country. The transfer
      is based on the European Commission's standard contractual clauses, and a data processing
      agreement under Art. 28 GDPR is in place.</p>`)}

    ${block('4. valorant-api.com', `
      <p>Map and agent data, rank emblems and their images are fetched by your browser directly
      from <a href="https://valorant-api.com" target="_blank" rel="noopener noreferrer">
      valorant-api.com</a> and media.valorant-api.com when the page loads. Your IP address is
      necessarily transmitted to that service, because your browser makes the request itself.</p>
      <p>valorant-api.com is an unofficial community project with no connection to Riot Games. The
      legal basis is Art. 6 (1) (f) GDPR; the legitimate interest is showing current game data
      without reproducing the artwork here.</p>`)}

    ${block('5. Match lookup (HenrikDev API)', `
      <p>If — and only if — you finalize a game on the Career page using the <i>Finalize</i>
      button, your browser sends the Riot ID you entered (name, tag and region) to this site. From
      there it is passed server-side to the <a href="https://docs.henrikdev.xyz" target="_blank"
      rel="noopener noreferrer">HenrikDev API</a> (api.henrikdev.xyz) to retrieve your recent
      matches. Your IP address is <b>not</b> transmitted to that service, because the request is
      made by the server rather than by your browser.</p>
      <p>The legal basis is Art. 6 (1) (f) GDPR; the legitimate interest is the function you
      asked for — matching a custom game you played to the line-up this app rolled. The Riot ID is
      not stored on the server, and results are kept only in your browser. The HenrikDev API is an
      unofficial community project with no connection to Riot Games. If you would rather not make
      this request, use <i>Enter Manually</i> instead.</p>`)}

    ${block('6. Local storage in your browser', `
      <p>The app stores your banned maps, the state of the agent board, your settings, your Riot
      ID and your custom game history in your browser's local storage, along with a cache of the
      last map and agent lists so it keeps working without a connection to the API.</p>
      <p>This data stays on your device, is never transmitted to me, and can be deleted at any
      time through your browser settings. As the storage is strictly necessary for the service you
      explicitly requested, no consent is required under § 25 (2) no. 2 TDDDG.</p>`)}

    ${block('7. Contacting me', `
      <p>If you email me, I process what you send solely to deal with your enquiry. The legal
      basis is Art. 6 (1) (f) GDPR. The data is deleted once the enquiry is settled and no
      retention obligations apply.</p>`)}

    ${block('8. Your rights', `
      <p>You have the right of access (Art. 15 GDPR), rectification (Art. 16), erasure (Art. 17),
      restriction of processing (Art. 18) and data portability (Art. 20 GDPR) at any time.</p>
      <p><b>Right to object:</b> where processing is based on Art. 6 (1) (f) GDPR, you have the
      right to object at any time on grounds relating to your particular situation
      (Art. 21 GDPR).</p>
      <p>You also have the right to lodge a complaint with a data protection supervisory
      authority, in particular in the member state of your residence or of the alleged
      infringement.</p>`)}

    ${block('9. Last updated', `
      <p>This privacy policy is dated ${updated || 'see the repository'}.</p>`)}`;
}

/* ----------------------------------------------------------------- view -- */

const DOCS = {
  imprint: { de: imprintDE, en: imprintEN },
  privacy: { de: privacyDE, en: privacyEN },
};

function paint() {
  const body = root.querySelector('#legalBody');
  const other = current === 'imprint' ? '/privacy' : '/imprint';
  const otherLabel = current === 'imprint' ? T[lang].other : T[lang].otherPrivacy;

  body.innerHTML = `
    <div class="legal__lang">
      <button type="button" class="btn btn--ghost" data-lang>
        <span>${T[lang].switch}</span>
      </button>
    </div>
    ${DOCS[current][lang]()}
    <p class="legal__foot">
      <a href="${other}">${esc(otherLabel)}</a> ·
      <a href="/map/ban">${esc(T[lang].back)}</a>
    </p>`;

  body.setAttribute('lang', lang);
  body.scrollTop = 0;
}

export default {
  async init(node) {
    root = node;
    lang = initialLang();

    root.addEventListener('click', (e) => {
      if (!e.target.closest('[data-lang]')) return;
      setLang(lang === 'de' ? 'en' : 'de');
      paint();
    });

    await loadImprint();
    if (missing().length) {
      console.warn(
        `[legal] Impressum incomplete — missing: ${missing().join(', ')}. ` +
        'Fill in public/data/imprint.json.'
      );
    }
  },

  show() {},
  hide() {},

  route(sub) {
    current = sub === 'privacy' ? 'privacy' : 'imprint';
    paint();
  },
};
