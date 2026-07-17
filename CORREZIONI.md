# Correzioni MapsAPP (v5-import-fix)

## Bug corretti in app.js

1. **Codici cliente disallineati tra i file (bug principale)**
   Il file clienti esporta il codice come numero (123 → "00123"), mentre ordini/vendite
   spesso lo esportano come testo a 6 cifre ("000123"). `padStart(5)` non tronca, quindi
   l'app creava clienti "fantasma" duplicati: gli importi e le righe prodotto finivano sul
   duplicato senza indirizzo, mai geocodificato. Risultato: mappa senza dati e ricerca
   prodotto che non trovava nulla sui clienti reali.
   → Nuova funzione `canonId()`: i codici numerici vengono canonizzati (zeri iniziali
   rimossi e ri-normalizzati a 5 cifre) in tutti e tre gli import.

2. **Intestazioni con accenti/apostrofi non riconosciute**
   `findType` richiedeva esattamente "CITTA": con "CITTÀ" o "CITTA'" (tipico degli export
   italiani) il file veniva scartato ("struttura non riconosciuta") e i clienti non
   venivano caricati affatto.
   → `normHeader()` rimuove accenti e apostrofi; accettate anche le colonne
   RAGIONE SOCIALE (senza "1"), LOCALITA, COMUNE.

3. **Riga titolo sopra le intestazioni**
   Le "stampe" dei gestionali hanno spesso una riga titolo (es. "STAMPA CLIENTI AL...")
   sopra le intestazioni: l'app leggeva sempre la riga 1 come intestazione e scartava il file.
   → `headerRowIndex()` cerca la riga di intestazione nelle prime 15 righe.

4. **Ricerca per codice articolo con zeri iniziali**
   Excel salva i codici numerici come numeri: "0700223" diventava 700223 e la ricerca
   con gli zeri non trovava nulla.
   → La ricerca prodotto ora confronta anche la versione senza zeri iniziali.

5. **Migrazione automatica dei salvataggi esistenti**
   `migrateClients()` all'avvio unisce i duplicati fantasma già presenti in IndexedDB
   (somma importi e righe, conserva coordinate e note). Non serve reimportare da zero.

6. **Geocodifica con fallback (clienti Sardegna/zone rurali)**
   Se Nominatim non trova l'indirizzo esatto (frequente per frazioni e strade rurali,
   spesso in Sardegna), ora riprova con CAP+città+provincia e poi solo città+provincia,
   invece di lasciare il cliente senza marker.

7. **Celle senza attributo `r`**
   Alcuni generatori xlsx omettono il riferimento cella: tutte le celle finivano in
   colonna A sovrascrivendosi. Aggiunto fallback posizionale in `colIndex`.

8. **Elenco limitato a 400 clienti senza avviso**
   Ora compare la nota "Elenco limitato a 400 di N clienti (la mappa li mostra tutti)".

## sw.js
Versione cache aggiornata a `maps-app-v5-import-fix`: senza questo, il service worker
avrebbe continuato a servire il vecchio app.js dalla cache anche dopo il deploy.

## v6 — Correzioni PWA (pulsante Installa)

**Causa principale: `icons/icon.svg` era un file da 1 byte (vuoto/corrotto).**
Chrome verifica i criteri di installabilità (manifest valido + icona utilizzabile +
service worker): con l'icona rotta l'evento `beforeinstallprompt` non scattava mai,
quindi il pulsante Installa non compariva o non faceva nulla.

Correzioni:
1. Icone rigenerate: PNG 192x192 e 512x512 (richieste da Chrome/Android),
   512x512 maskable, apple-touch-icon 180x180 per iOS, più un SVG valido.
2. Manifest completo: id, scope, orientation e set di icone PNG con purpose separati
   (any / maskable — "any maskable" insieme è sconsigliato).
3. index.html: apple-touch-icon e meta apple-mobile-web-app-* (iOS non legge le
   icone dal manifest).
4. Pulsante Installa robusto: usa beforeinstallprompt dove esiste (Chrome/Edge/Android);
   su iPhone/iPad mostra le istruzioni "Condividi → Aggiungi a schermata Home"
   (iOS non ha alcuna API di installazione); il pulsante è visibile quando l'app
   non è già installata e si nasconde dopo l'installazione (evento appinstalled).
5. Service worker v6: strategia network-first per i file dell'app (gli aggiornamenti
   arrivano subito, offline resta funzionante) e cache delle nuove icone.

Requisiti da ricordare: la PWA è installabile solo via HTTPS (o http://localhost).
Da GitHub Pages funziona; aprendo index.html come file:// no.

## v7 — Nuove funzioni: Giro visite e Stato clienti

### Giro visite con percorso
- Pulsante "+ Giro" su ogni cliente (elenco e scheda) e "Aggiungi filtrati" per
  inserire in blocco i clienti del filtro corrente (max 30 tappe).
- "Ottimizza percorso": ordina le tappe col criterio del più vicino, partendo dalla
  posizione GPS dell'utente (se autorizzata) o dalla prima tappa; mostra i km stimati.
- Percorso disegnato sulla mappa (linea tratteggiata blu + pin numerati).
- Link "Apri in Google Maps" con navigazione multi-tappa; oltre 11 punti il percorso
  viene diviso automaticamente in tratte concatenate (limite dell'URL di Google Maps).
- Il giro è salvato nel progetto (IndexedDB ed export JSON).

### Stato clienti (in calo / dormienti)
- L'anno di riferimento è il più recente presente nei dati vendite.
- "In calo": vendite nell'anno di riferimento inferiori al 60% dell'anno precedente
  (badge rosso con la percentuale, es. "In calo -76% 2024→2025").
- "Dormiente": storico vendite presente ma zero nell'anno di riferimento.
- Nuovo filtro "Stato" (In calo / Dormienti / Attivi) e colori marker aggiornati:
  rosso=in calo, grigio=dormiente, arancio=ordini aperti, verde=top, blu=altri
  (legenda nel pannello filtri).
- Attenzione: se l'anno di riferimento è l'anno in corso (parziale), i confronti
  possono sovrastimare i cali — interpretare i badge di conseguenza.

sw.js: cache v7 (necessario per distribuire i nuovi file).

## v8 — Percorso realistico e costi di viaggio

### Niente più percorsi attraverso il mare
- Ogni tappa viene classificata per massa terrestre (Continente / Sardegna / Sicilia)
  in base alle coordinate; lo Stretto di Messina separa correttamente Reggio Calabria
  (continente) da Messina (Sicilia).
- L'ottimizzazione avviene per sezione: le sezioni non vengono mai collegate via terra,
  né sulla mappa né nei link di navigazione. Tra le sezioni l'app segnala "⛴ serve
  traghetto/volo". I link Google Maps sono etichettati per sezione
  ("Continente – tratta 1", "Sardegna", "Sicilia").

### Percorso più corto (chilometrico)
- Dopo il nearest-neighbor viene applicata l'euristica 2-opt, che elimina gli incroci
  e accorcia il percorso (nei test: -20% su casi in cui il solo nearest-neighbor sbaglia).
- I km mostrati sono quelli stradali reali calcolati con OSRM (router.project-osrm.org,
  gratuito, senza chiave); se OSRM non risponde si usa la stima in linea d'aria ×1,3,
  chiaramente etichettata come "stima".

### Costi carburante e pedaggi (valori aggiornabili)
- Parametri modificabili e salvati nel progetto: consumo (l/100km), prezzo carburante
  (€/l), pedaggio (€/km) e % di km in autostrada.
- Default impostati con i dati di luglio 2026: benzina self ~1,90 €/l (rilevazioni
  Mimit metà luglio 2026); pedaggio classe A ~0,095 €/km IVA inclusa (tariffa media
  0,07825 €/km + IVA 22%). Il prezzo carburante cambia ogni settimana: aggiornarlo
  dal campo dedicato.
- I pedaggi sono stimati SOLO sui km del continente: le autostrade siciliane
  (A18/A19/A20/A29) sono in gran parte gratuite e in Sardegna non ci sono autostrade
  a pedaggio.
- Il riepilogo mostra: km per sezione, costo carburante, pedaggi e totale viaggio.

sw.js: cache v8.

## v9 — Percorso stradale reale e invalidazione del giro

Diagnosi dallo screenshot: tappe con numeri non consecutivi sulle isole = giro in
ordine di inserimento (modificato dopo l'ultima ottimizzazione o calcolato con la
versione precedente in cache). L'app disegnava comunque le linee in quell'ordine
(da lì le tratte sul mare) e le sezioni da 1 tappa non generavano alcun link
(per questo comparivano solo pulsanti "Continente").

1. **Invalidazione automatica**: qualsiasi modifica al giro (aggiunta/rimozione tappe)
   marca il percorso come "da ricalcolare": i link di navigazione spariscono, i pin
   diventano grigi e compare l'avviso "Giro modificato: premi Ottimizza percorso".
   Niente più linee disegnate su ordini non ottimizzati.
2. **Percorso stradale reale sulla mappa**: dopo l'ottimizzazione la mappa mostra la
   geometria stradale effettiva restituita da OSRM (linea blu continua che segue
   autostrade e strade vere), non più segmenti retti che tagliano il mare.
   Se OSRM non risponde: linea tratteggiata schematica come prima.
   La geometria è decimata a max 400 punti per sezione e salvata nel progetto.
3. **Link anche per sezioni da 1 tappa**: una singola tappa in Sardegna/Sicilia ora
   genera il suo pulsante "Sardegna (1 tappa)" con navigazione diretta.
4. **Confine Sicilia esteso alle Eolie** (Stromboli, Panarea, Lipari → sezione Sicilia,
   raggiungibili in traghetto da lì); costa calabra verificata città per città
   (Tropea, Capo Vaticano, Pizzo, Scilla, Cetraro restano continente).

sw.js: cache v9.

## v10 — Filtri geografici multipli: Regioni e Province

- Il vecchio menu a tendina "provincia singola" è sostituito da due selettori a
  spunta (checkbox): **Regioni** e **Province**. Si aprono/chiudono con un tap,
  mostrano il conteggio clienti accanto a ogni voce e il riepilogo nel titolo
  ("Regioni (2)", "Province (5)").
- Semantica: più voci nella stessa casella = OR (es. MI + BG + BS); Regioni e
  Province si combinano in AND. Selezionando una o più regioni, l'elenco province
  mostra solo quelle delle regioni scelte; le province non più visibili vengono
  deselezionate automaticamente.
- Mappa completa delle 111 sigle provinciali italiane → 20 regioni (incluse le
  sigle storiche sarde CI/VS/OT/OG e MB, BT, FM, SU). Province non riconosciute
  (estero o refusi) finiscono nel gruppo "Altro/Estero".
- Tutti gli strumenti a valle rispettano i nuovi filtri: elenco, mappa,
  "Aggiungi filtrati" al giro visite, geocodifica dei filtrati, statistiche.
- Nota: se il gestionale esporta il nome per esteso ("MILANO" invece di "MI"),
  il filtro provincia funziona comunque per valore esatto, ma la voce ricade
  in "Altro/Estero" a livello di regione.

sw.js: cache v10.

## v11 — Punto di partenza del giro e Mailing list

### Punto di partenza selezionabile
- Nel pannello Giro visite: campo "Punto di partenza" con pulsante **📍 GPS**
  (posizione attuale) oppure **indirizzo digitato** (via, città o CAP), geocodificato
  con Nominatim. La partenza scelta è salvata nel progetto e mostrata sotto il campo.
- "Ottimizza percorso" non chiede più il GPS ogni volta: usa la partenza impostata.
  Senza partenza, il percorso parte dalla prima tappa (comportamento dichiarato in UI).
- Cambiando la partenza il percorso viene invalidato: va ripremuto "Ottimizza".
- "Svuota" cancella le tappe ma NON la partenza impostata.

### Mailing list (nuovo pannello)
- Conta e mostra gli indirizzi dei **clienti filtrati**: "N indirizzi univoci da M
  clienti su X filtrati", con evidenza di esclusi e clienti senza email.
- **Esporta CSV mailing list**: file `mailing-list_AAAA-MM-GG.csv` con colonne
  EMAIL, RAGIONE SOCIALE, CODICE CLIENTE, CITTA, PROVINCIA, REGIONE, AGENTE,
  CLASSE ABC, STATO, VENDITE, ORDINI APERTI — utili per segmentare le campagne.
  Formato: UTF-8 con BOM + CRLF + escaping RFC-4180 → si apre in Excel con doppio
  clic (accenti corretti) e si importa in Mailchimp/Brevo/Outlook senza conversioni.
- **Copia**: tutti gli indirizzi negli appunti separati da "; " per incollarli in CCN.
- **Gestisci indirizzi**: elenco dei clienti filtrati con un flag per ogni indirizzo.
  Togliendo la spunta l'indirizzo è escluso dall'export; l'esclusione è salvata nel
  progetto (chiave cliente+indirizzo, quindi la stessa email su due clienti resta
  indipendente). Pulsanti rapidi: Seleziona tutti / Deseleziona tutti /
  Escludi PEC-amministrative (riconosce pec., legalmail, amministrazione@,
  contabilita@, fatture@, ragioneria@).
- Parsing email migliorato all'import: una cella con più indirizzi separati da
  ";", ",", "/" o spazi viene divisa correttamente; gestiti "mailto:" e il formato
  "Nome <mail@dom.it>"; indirizzi non validi scartati; dedup case-insensitive.

Nota GDPR: l'export contiene dati personali di clienti. Usarlo per comunicazioni
commerciali verso clienti esistenti è generalmente ammesso (soft spam opt-in,
art. 130 c.4 Codice Privacy) purché ogni invio abbia un link di disiscrizione
funzionante e si rispettino le richieste di cancellazione. Per i prospect mai
attivati serve invece un consenso raccolto.

sw.js: cache v11.

## v12 — Correzione classificazione clienti (bug dormienti)

### Bug segnalato: dormienti con ordini aperti
`clientStatus()` classificava dormiente qualunque cliente con storico e zero vendite
nell'anno di riferimento, **senza guardare il portafoglio ordini**. Un cliente con un
ordine in corso non è dormiente: è attivo, in attesa di consegna.
→ Ora un cliente con ordini aperti non è mai classificato dormiente.

### Bug più grave emerso durante l'analisi: anno di riferimento parziale
REF_YEAR era l'anno più recente presente nei dati, cioè l'**anno in corso** (2026),
completo solo per metà. Conseguenze sui dati reali (1.788 clienti, export 17/07/2026):
- 82 clienti che avevano acquistato negli ultimi 12 mesi (ma non nel 2026 solare)
  risultavano "dormienti": 347.000 € di vendite negli ultimi 12 mesi trattate come
  clientela persa;
- 43 clienti risultavano "in calo" solo perché 6 mesi di 2026 venivano confrontati
  con 12 mesi di 2025;
- 21 cali veri restavano invece nascosti.

→ La classificazione usa ora **finestre mobili di 12 mesi** calcolate sulle date reali
delle righe di vendita (già presenti nei dati importati): ultimi 12 mesi vs 12 mesi
precedenti, confronto omogeneo. La data di riferimento è l'ultima data presente nei
dati (mostrata in interfaccia: "Stato clienti calcolato su: 12 mesi al gg/mm/aaaa").
Le date future (errori di digitazione) non spostano la finestra.

Definizioni aggiornate:
- **Dormiente**: ha storico, zero acquisti negli ultimi 12 mesi, nessun ordine aperto.
  L'etichetta ora indica l'anzianità reale ("Dormiente da 21 mesi").
- **In calo**: ultimi 12 mesi sotto il 60% dei 12 precedenti ("In calo -75% (12 mesi)").
- **Attivo**: acquisti negli ultimi 12 mesi oppure ordini aperti.

Effetto sui dati reali: dormienti 658 → 572, in calo 62 → 40, attivi 139 → 247.

### Compatibilità e prestazioni
- Progetti vecchi senza date nelle righe: fallback sull'ultimo anno **completo**
  (mai sull'anno in corso parziale), quindi nessuna regressione.
- Il ricalcolo delle finestre (16.387 righe) è in cache: si esegue solo quando i dati
  cambiano, non a ogni digitazione nei filtri (24ms → 0,2ms per ridisegno).

sw.js: cache v12.

## v12.0 — Versione visibile e avviso di aggiornamento

Problema: non c'era modo di sapere quale versione stesse girando (la PWA serve i file
dalla cache del service worker, quindi dopo un deploy si può continuare a usare la
versione vecchia senza accorgersene).

- **Badge versione nell'header**, accanto a "Maps APP": mostra "v12.0".
  Se il sw.js sul server ha una versione diversa da quella attesa, il badge diventa
  arancione e indica la versione trovata online.
- **Avviso di aggiornamento**: quando il service worker scarica una versione più
  recente, compare in basso un banner "È disponibile una versione più recente" con il
  pulsante **Aggiorna ora**, che deregistra il vecchio service worker e ricarica.
  Niente più doppi refresh manuali.
- Controllo automatico degli aggiornamenti all'avvio e ogni ora.

### Come verificare la versione a colpo d'occhio
1. Badge nell'header: deve indicare v12.0 (grigio = allineato, arancione = da aggiornare).
2. Sotto i filtri deve comparire: "Stato clienti calcolato su: 12 mesi al …"
   (questa riga esiste solo dalla v12).
3. Devono esserci: filtri Regioni/Province a spunta, pannello Mailing list,
   campo "Punto di partenza" con pulsante GPS nel Giro visite.

## v12.1 — Cali recenti nascosti e definizione di "TOP" (segnalazione BERTOROTTA)

### Bug 1: la finestra a 12 mesi nasconde i crolli recenti
Caso reale BERTOROTTA SRL (verde sulla mappa, ma in evidente caduta):
- ultimi 12 mesi 70.363 € vs 12 precedenti 64.794 € → +9%: nessun allarme;
- ma ultimi 6 mesi 15.126 € vs stessi 6 mesi dell'anno prima 31.578 € → **-52%**;
- semestri: 2024 H2 33.216 € · 2025 H1 31.578 € · 2025 H2 55.237 € · 2026 H1 15.126 €.

La finestra a 12 mesi è un indicatore lento: contiene ancora i mesi forti di 10 mesi fa
e può mascherare un crollo per quasi un anno.
→ Aggiunto un **secondo segnale a 6 mesi**: ultimi 6 mesi vs gli stessi 6 mesi dell'anno
precedente (confronto neutro rispetto alla stagionalità). Un cliente è "in calo" se
peggiora sulla finestra a 12 mesi **oppure** su quella a 6 mesi. L'etichetta indica quale
segnale è scattato: "In calo -52% (ultimi 6 mesi)".
Sui dati reali intercetta **15 cali** che prima erano invisibili, inclusi clienti che sulla
finestra a 12 mesi risultavano addirittura +219% e +300%.

### Bug 2: "TOP" calcolato sullo storico di sempre
Il verde indicava "cliente sano" ma si basava sulle vendite cumulate dal 2019
(`sales > 50.000 €`). Risultato: clienti fermi da anni restavano verdi grazie al passato —
es. un cliente con 82.279 € di storico e **285 €** negli ultimi 12 mesi era verde.
→ **TOP = almeno 20.000 € negli ultimi 12 mesi**. Sui dati reali sono 38 clienti che
valgono il 66% del venduto dell'anno (soglia coerente con la distribuzione: i primi 10%
dei clienti attivi fanno il 58% del fatturato). Lo storico resta visibile nella scheda
cliente, ma non determina più il colore.

### Bug 3 (emerso dai test): nessuna soglia anti-rumore sulla finestra a 12 mesi
La regola a 6 mesi aveva una soglia minima, quella a 12 mesi no: venivano segnalati
"in calo" clienti passati da 380 € a 205 €. → Soglia minima di **3.000 €** sul periodo di
confronto per entrambe le finestre (esclude 5 micro-cali per 2.925 € complessivi).

### Effetto sui dati reali (1.788 clienti, 15/07/2026)
| Segmento | prima | dopo |
|---|---:|---:|
| In calo (rosso) | 40 | **50** |
| Dormienti (grigio) | 572 | 572 |
| Ordini aperti (arancio) | 38 | 37 |
| Top (verde) | 24 | **15** |
| Altri (blu) | 1.114 | 1.114 |

Perdita dei clienti in calo: 851.882 € negli ultimi 12 mesi.
Prestazioni invariate: ricalcolo 42ms una tantum, 0,15ms per ridisegno con cache.

sw.js: cache v12.1.

## v12.2 — Il calo tiene conto degli ordini in corso

Domanda emersa in revisione: la percentuale di calo considerava solo il **consegnato**
(cioè il fatturato), ignorando il portafoglio ordini. Un cliente con una consegna in
ritardo ma un ordine importante in corso risultava "in calo" pur non avendo smesso
di comprare.

Verifica sui dati reali: dei clienti segnalati in calo, 8 avevano ordini aperti per
79.050 €. Le righe d'ordine aperte sono quasi tutte recentissime (105 su 153 negli
ultimi 3 mesi, 147 su 153 entro 6 mesi, una sola oltre i 12 mesi): sono domanda
attuale, non ordini fermi.

→ Il calo continua a confrontare il **consegnato** (unico dato disponibile in serie
storica), ma **somma gli ordini in corso al periodo attuale**, assegnandoli alla
finestra in base alla data di creazione dell'ordine. L'etichetta lo dichiara:
"In calo -46% (ultimi 6 mesi, ordini inclusi)".

Falsi allarmi eliminati sui dati reali:
- D.CAR di FORMICONI: consegnato 16.504 € vs 36.507 € (-55%) + 23.370 € in ordine
  → 109% del periodo precedente: **non è in calo**;
- BISSA di BISSA ABELE: 82.909 € vs 125.623 € + 11.850 € in ordine → 75%: non in calo;
- IL RE DELLE GOMME e CENTRO ARIA COMPRESSA: idem.
Cali confermati anche contando gli ordini: ECOPROGRAM FLOTTE (-65%), EFFEGI SYSTEMS
(-96%), O.M.Z. (-46%), GABRIELE UTENSILI (-44%), QUALITY SERVICE (-98%).

Nota metodologica onesta: il confronto è asimmetrico, perché il periodo attuale
include il portafoglio ordini mentre quello precedente contiene solo consegnato
(il gestionale non fornisce lo storico degli ordini acquisiti, solo l'inevaso di oggi).
L'asimmetria è voluta e prudente: evita di dichiarare "in calo" un cliente che sta
ancora ordinando.

Corretto anche un difetto nella costruzione dell'etichetta (parentesi non chiusa nel
caso di progetti senza date nelle righe).

### Effetto sui dati reali
In calo 50 → **47** · Ordini aperti 37 → **40** · Dormienti 572 · Top 15 · Altri 1.114.
Perdita dei clienti in calo: 798.842 € negli ultimi 12 mesi.

sw.js: cache v12.2.
