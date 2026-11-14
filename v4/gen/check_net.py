import re,sys,os
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from design import PARTS
t=re.sub(r'\s+',' ',open(sys.argv[1]).read())
got={}
nets=t[t.find('(nets'):]
for m in re.finditer(r'\(net \(code "\d+"\) \(name "([^"]*)"',nets):
    end=nets.find('(net (code',m.end())
    blk=nets[m.start():end if end>0 else len(nets)]
    for r,p in re.findall(r'\(node \(ref "([^"]+)"\) \(pin "([^"]+)"',blk):
        got[(r,p)]=m.group(1)
bad=0
for part in PARTS:
    for pin,net in part['pins'].items():
        g=got.get((part['ref'],pin))
        if net is None:
            if g and not g.startswith('unconnected'): print('NC mismatch',part['ref'],pin,g); bad+=1
        elif g!=net: print('MISMATCH',part['ref'],pin,'exp',net,'got',g); bad+=1
print('checked pins, bad =',bad,'| nets:',sorted(set(v for v in got.values() if not v.startswith('unconnected'))))
