# haystack

Lattviktig svensk chattapp for svagare enheter.

## Funktioner

- Logga in / skapa konto med valfritt anvandarnamn och losenord
- Gastkonto med globalt chattrum
- Vanforfragningar i egen flik
- Lagg till anvandare via anvandarnamn
- End-to-end krypterade privata chattar mellan vanner (via proxy-endpoint)
- Egen profilbild via URL
- Fildelning (alla filtyper), bild- och videodelning
- Installningar: morkt lage, hog kontrast, textstorlek, minskad rorelse
- Minimal design for snabb drift pa enklare datorer
- Inga animationer

## Starta

```bash
python3 server.py
```

Oppna sedan:

`http://127.0.0.1:3000`

## Lagring

All data sparas i `haystack_data.json`:

- konton
- vanrelationer
- forfragningar
- meddelanden
