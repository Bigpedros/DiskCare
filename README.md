# DiskCare v1.0 — Spazio recuperabile e trasferimenti sicuri

Questa versione parte dalla v0.9 e cambia il centro dell'app: non mostra solo quanti file trova, ma soprattutto **quanto spazio può essere recuperato**, con quale livello di affidabilità e con quale rischio.

## Novità principali

- Recuperabile verificato, potenzialmente recuperabile e selezionato per pulizia.
- Opportunità ordinate per GB/MB recuperabili.
- Niente doppi conteggi: se una cartella duplicata comprende determinati file, quei file non vengono ricontati come duplicati singoli.
- Cartelle/alberi duplicati aggregati.
- Protezione esplicita di Windows, WinSxS, Program Files, ProgramData, System Volume Information, pagefile.sys, hiberfil.sys e swapfile.sys.
- Cache e preview rigenerabili riconosciute separatamente.
- Installer vecchi e Cestino separati dai file personali.
- File personali grandi mostrati come da valutare, ma non considerati automaticamente eliminabili.
- Verifica SHA-256 per i file gestibili in sicurezza nel browser.
- Per file molto grandi la PWA non elimina mai l'origine se non può completare la verifica integrale.

## Consolida cartelle

Nella vista Cartelle duplicate è possibile:

- verificare la struttura;
- copiare gli elementi mancanti da A a B;
- copiare gli elementi mancanti da B ad A;
- bloccare automaticamente i conflitti con stesso nome ma contenuto differente.

La sorgente non viene eliminata automaticamente dopo un consolidamento.

## Copia / Sposta

È disponibile una nuova sezione indipendente dai duplicati:

- copia uno o più file verso una cartella autorizzata;
- copia un'intera cartella verso un altro percorso/disco;
- sposta in sicurezza, eliminando l'origine solo dopo verifica riuscita quando le API del browser lo consentono;
- mantiene l'origine se la PWA non può verificare o rimuovere in modo affidabile il file;
- registra l'esito dell'operazione.

## Limiti PWA

Netlify + PWABuilder producono una PWA installabile, ma il browser richiede che l'utente autorizzi esplicitamente i percorsi tramite i selettori. La futura build desktop potrà accedere ai dischi con un livello di integrazione maggiore.

## Sicurezza

DiskCare mantiene la filosofia originale:

1. analizza;
2. spiega;
3. verifica;
4. copia/consolida quando serve;
5. mette in quarantena prima di eliminare;
6. non considera mai l'età, da sola, una ragione sufficiente per cancellare un file.


## UX guidata — restyling ottobre 2026

Questa variante introduce una Home orientata all'obiettivo invece che alle funzioni tecniche:

- Recupera spazio
- Sistema duplicati
- Copia o unisci cartelle
- Quarantena

Le sezioni tecniche restano disponibili sotto **Strumenti avanzati**. La logica di sicurezza originale non viene rimossa: SHA-256, protezioni dei percorsi di sistema, quarantena e blocco dei conflitti restano invariati.

Principio UX adottato: ogni schermata deve chiarire **dove sono, cosa sta succedendo e cosa devo fare adesso**.
