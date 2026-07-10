# Cormach Maps

PWA locale per importare i file Excel di anagrafica clienti, ordini e vendite.

## Avvio
La PWA deve essere pubblicata tramite HTTPS oppure avviata da un server locale; non aprire `index.html` direttamente con doppio clic.

Esempio locale:

```bash
cd cormach-maps-pwa
python3 -m http.server 8080
```

Poi aprire `http://localhost:8080`.

## Flusso consigliato
1. Importare `stampa clienti`.
2. Importare `stampa ordini`.
3. Importare `stampa vendite`.
4. Avviare la geocodifica degli indirizzi mancanti.
5. Esportare periodicamente il progetto JSON come backup.
6. Quando arrivano nuovi Excel, importarli: note e coordinate già salvate vengono conservate.

## Privacy e rete
I file Excel e il progetto restano nel browser. La mappa e la geocodifica usano servizi OpenStreetMap online; le risorse già visitate vengono memorizzate dal service worker quando possibile.


## Ricerca prodotti
Filtra dinamicamente per codice articolo o descrizione, per vendite/ordini e per intervallo di anni.
