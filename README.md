# Maps APP

PWA locale per importare e aggiornare file Excel di clienti, ordini e vendite.

## Compatibilità nativa
Maps APP riconosce automaticamente, dal contenuto delle colonne, i tre formati Excel allegati:

- stampa clienti
- stampa ordini
- stampa vendite

Il nome del file può cambiare; la struttura delle colonne deve restare compatibile.

## Avvio
La PWA deve essere pubblicata tramite HTTPS oppure avviata da un server locale. Non aprire `index.html` direttamente con doppio clic.

```bash
cd Maps-APP
python3 -m http.server 8080
```

Aprire poi `http://localhost:8080`.

## Flusso consigliato
1. Importare i tre Excel, anche contemporaneamente.
2. Geocodificare gli indirizzi mancanti.
3. Cercare per cliente, città, provincia, agente, codice prodotto o descrizione.
4. Filtrare vendite, ordini e intervallo di anni.
5. Esportare periodicamente il progetto JSON come backup.
6. Importare i nuovi Excel per aggiornare i dati: note e coordinate locali restano conservate.

## Privacy e rete
I file Excel e il progetto restano nel browser. Le tessere della mappa e la geocodifica usano servizi OpenStreetMap online.


## Correzione v2
Il lettore Excel è incluso localmente. I file allegati clienti, ordini e vendite vengono riconosciuti dalla struttura delle colonne, senza dipendere dal nome del file.
