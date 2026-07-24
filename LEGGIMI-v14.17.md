# Maps APP v14.17 — il progetto viaggia col link

## Cosa ho verificato prima di toccare il codice

Ho scaricato i file dal tuo `main` su GitHub e li ho confrontati con quelli che ti
avevo consegnato: `app.js`, `sw.js` e `index.html` sono **identici**, v14.16 è
correttamente pubblicata. Quindi il problema non è un aggiornamento mancato: la mia
diagnosi era incompleta.

## Perché la v14.16 non bastava

Le correzioni della v14.16 erano giuste ma agivano tutte su *come* la app salva. Il
salvataggio adesso è verificato per rilettura: la app scrive, rilegge l'archivio e
conta i clienti. Se ti dice "SALVATO: 28 clienti", quei 28 clienti **erano davvero
nell'archivio** in quel momento.

Il che sposta il problema: se il dato c'era e poi sparisce, non è la app che non
salva, è il sistema operativo che **cancella** l'archivio dopo. Contro questo nessuna
correzione al codice di salvataggio può funzionare, perché il codice ha già fatto
il suo lavoro correttamente.

Succede in due situazioni, entrambe tipiche di un agente che riceve un link:

- **Anteprima interna di WhatsApp / Gmail / Telegram.** Toccando un link dentro
  l'app di messaggistica non si apre Safari ma un browser interno con archivio
  temporaneo, azzerato a ogni chiusura. È lo scenario più probabile.
- **Safari con sito non installato.** iOS libera lo spazio dei siti non aggiunti
  alla schermata Home, senza avvisare.

## La soluzione: il progetto agganciato al link

Invece di sperare che il telefono di Dolce conservi i dati, il progetto viene
**ripreso dal link a ogni apertura**. Se il browser cancella tutto, riaprendo il link
Dolce ritrova i suoi 28 clienti da solo: nessun file da cercare, nessun passaggio.

**Come si usa.** Metti nel repo una cartella `agenti/` con un file per agente:

```
agenti/dolce.json      <- te l'ho già preparato
agenti/rossi.json
```

e manda all'agente il link col suo nome:

```
https://pezzaliapp.github.io/MapsAPP/?agente=dolce
```

In alternativa `?data=percorso/file.json` per un percorso libero. Per sicurezza sono
accettati solo file pubblicati insieme alla app, non indirizzi esterni.

**Comportamento:**

| Situazione | Cosa fa |
|---|---|
| Archivio vuoto (primo accesso o dati cancellati) | Carica dal link, in silenzio |
| Archivio pieno, link più vecchio | Non tocca niente |
| Archivio pieno, link più recente | Banner con tre scelte: Unisci / Sostituisci / No |

Il caso importante è il terzo: se aggiorni `agenti/dolce.json` dal gestionale, al
primo accesso utile Dolce vede il banner e sceglie **Unisci**, così le sue modifiche
non vengono perse.

## Rilevamento della cancellazione

Piccola sentinella in `localStorage` con numero di clienti e data dell'ultimo
salvataggio. Se la sentinella dice che c'erano dati e l'archivio è vuoto, la app lo
dice chiaramente invece di presentarsi muta e vuota — distingue "non ho mai salvato"
da "me li hanno cancellati". Visibile anche in *Diagnostica salvataggio*.

Test superati: primo accesso 28 clienti; riapertura 28; archivio azzerato → 28
recuperati dal link con messaggio corretto; senza parametro nel link → avviso di
cancellazione mostrato.

## Da aggiornare su GitHub

- `app.js`
- `sw.js`
- `agenti/dolce.json` (cartella nuova)

`index.html` è invariato rispetto alla v14.16: se l'hai già caricato, lascialo.

Dopo il push, premi *Ripristina app* una volta.

## La domanda che chiude il caso

Quando Dolce apre il json, **che messaggio vede?**

- «Progetto aperto e SALVATO su questo dispositivo: 28 clienti» → il salvataggio è
  riuscito e verificato, quindi è il sistema che cancella dopo: il link agganciato
  risolve.
- «ATTENZIONE: il progetto è aperto sullo schermo ma NON è stato salvato» → la
  scrittura fallisce sul momento, e il messaggio contiene il motivo esatto.

Fallo premere anche su *Diagnostica salvataggio*: copia negli appunti un riepilogo
che puoi incollarmi. La riga *Modo* dice subito se sta lavorando in un browser
interno o nella app installata.
