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
