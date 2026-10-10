# DiskCare v0.9 — Restyling cromatico + Prestazioni persistenti

Include tutte le funzioni della v0.8, più:

## Restyling
- sfondo generale giallo paglierino molto tenue;
- sidebar celeste chiaro;
- testi scuri nella navigazione;
- pannelli operativi blu profondo per creare contrasto;
- card riepilogo chiare;
- badge funzionali più distinti;
- maggiore separazione visiva tra navigazione, contenuto e azioni.

## Prestazioni
- i profili Leggera / Normale / Massima restano sempre cliccabili;
- la scelta può essere modificata senza applicarla definitivamente;
- pulsante "Salva impostazione";
- persistenza tramite localStorage;
- alla riapertura DiskCare recupera l'ultimo profilo salvato;
- pulsante "Ripristina Normale";
- indicatore "Salvato" / "Da salvare".

## Logica consolidata
- mantiene classificazione prudente della v0.8;
- residui sicuri separati;
- System Volume Information protetto;
- verifica globale duplicati;
- cartelle duplicate aggregate;
- azioni batch protette;
- menu "Da valutare" allineato ai soli file realmente da verificare.

Nota: nel prototipo Netlify la quarantena resta simulata e la limitazione reale al solo disco E: richiederà la futura build desktop.
