"""Deterministic domain normalization -- no agent involvement here, this
is plain string manipulation, not semantic reasoning.

Only strips a short, explicit list of device/presentation-style prefixes
(www, m, mobile, amp), looping until none remain so stacked prefixes like
m.www.example.com fully collapse. Deliberately does NOT reduce to the
registrable domain (eTLD+1) the way a public-suffix-list library would --
that would also collapse meaningfully different subdomains together
(mail.google.com and drive.google.com would both become google.com),
losing exactly the kind of signal habit analytics wants. It would also
mishandle multi-part suffixes (something.com.bd should stay
something.com.bd, not become com.bd) without a real public suffix list.
If you ever want true eTLD+1 handling for a different purpose, tldextract
is the right tool -- it solves a different problem than this one does.
"""

from urllib.parse import urlparse

_STRIP_PREFIXES = ("www.", "m.", "mobile.", "amp.")


def normalize_domain(url):
    if not url:
        return None
    hostname = urlparse(url).hostname
    if not hostname:
        return None
    hostname = hostname.lower()

    changed = True
    while changed:
        changed = False
        for prefix in _STRIP_PREFIXES:
            if hostname.startswith(prefix):
                hostname = hostname[len(prefix):]
                changed = True

    return hostname or None
