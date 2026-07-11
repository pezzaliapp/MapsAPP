# Maps APP

PWA locale per importare e aggiornare file Excel di clienti, ordini e vendite.

## Compatibilità nativa

Riconosce automaticamente dal contenuto delle colonne i tre formati:

- stampa clienti
- stampa ordini
- stampa vendite

I file Excel non sono inclusi nell'applicazione.

## Correzione v4

I dati vengono salvati in IndexedDB invece che in localStorage. Questo consente di importare anche il file vendite completo, composto da oltre 16.000 righe, su Safari iPhone e iPad.

## Avvio

Pubblicare tramite HTTPS oppure avviare da server locale:

```bash
python3 -m http.server 8080
```
