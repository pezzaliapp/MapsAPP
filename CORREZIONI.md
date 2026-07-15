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
