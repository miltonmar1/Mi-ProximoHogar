"""Utilidades para telefonos (WhatsApp, etc.)."""
from __future__ import annotations

import re
from urllib.parse import quote


def normalizar_whatsapp(telefono: str | None, pais: str = "51") -> str | None:
    """Devuelve numero en formato internacional sin + para wa.me (ej. 51987654321)."""
    if not telefono:
        return None
    digits = re.sub(r"\D", "", str(telefono))
    if not digits:
        return None
    if digits.startswith("00"):
        digits = digits[2:]
    if len(digits) >= 11 and digits.startswith(pais):
        return digits
    if len(digits) == 9 and digits[0] == "9":
        return pais + digits
    if len(digits) == 10 and digits.startswith("0"):
        return pais + digits[1:]
    if len(digits) >= 7 and not digits.startswith(pais):
        return pais + digits
    if len(digits) >= 7:
        return digits
    return None


def url_whatsapp(telefono: str | None, texto: str = "") -> str | None:
    numero = normalizar_whatsapp(telefono)
    if not numero:
        return None
    url = f"https://wa.me/{numero}"
    if texto:
        url += "?text=" + quote(texto, safe="")
    return url
