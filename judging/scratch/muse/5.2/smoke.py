# -*- coding: utf-8 -*-
from medical_fts import FrenchMedicalSearch, normalize_french
s = FrenchMedicalSearch()
a = s.add_document("OAP", "Cardio", "oedème aigu du poumon avec dyspnée")   # accented + oe
b = s.add_document("IRC rénale", "Néphro", "insuffisance rénale chronique et créatinine")
c = s.add_document("IRC respiratoire", "Pneumo", "insuffisance respiratoire chronique et BPCO")
d = s.add_document("Infarctus", "Cardio", "infarctus du myocarde aigu ST+")
print("norm:", normalize_french("œdème") == normalize_french("oedeme") == "oedeme")
r = s.search("œdème")
print("accent search hits:", [x["rowid"] for x in r])
r2 = s.search("IRC")
print("IRC hits:", sorted(x["rowid"] for x in r2), "expanded:", r2[0]["expanded_query"] if r2 else None)
r3 = s.search("IDM")
print("IDM hits:", [x["rowid"] for x in r3])
r4 = s.search("infarctus du myocarde")
print("phrase boost flags:", [(x["rowid"], x["phrase_matched"]) for x in r4])
