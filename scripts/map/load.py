import json, pickle, sys
src = sys.argv[1]; out = sys.argv[2]
d = json.load(open(src))
nodes = {}  # (area,id) -> (x,y,flags)
segs = []
for area in d:
    aid = area['AreaId']
    for n in area['Nodes'] or []:
        p = n['Position']
        nodes[(aid, n['Id'])] = (p['X'], p['Y'], n['IsOnWater'], n['IsFreeway'], n['IsGravelRoad'], n['IsBackroad'], n.get('StreetName'))
        for c in n['ConnectedNodes'] or []:
            q = c['Node']['Position']
            segs.append((p['X'], p['Y'], q['X'], q['Y'], n['IsOnWater'] or c['Node']['IsOnWater'], n['IsFreeway'] and c['Node']['IsFreeway'],
                         n['IsGravelRoad'] or c['Node']['IsGravelRoad'], n['IsBackroad'] and c['Node']['IsBackroad'], c.get('LaneCountForward', 1) + c.get('LaneCountBackward', 0)))
pickle.dump({'nodes': list(nodes.values()), 'segs': segs}, open(out, 'wb'))
print(len(nodes), len(segs))
