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
