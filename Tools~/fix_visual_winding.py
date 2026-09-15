#!/usr/bin/env python3
"""Produce separately versioned winding-corrected copies of the supplied GLBs.
Specific to the supplied pack: each original primitive is an independent convex
solid. This is NOT a general concave-mesh repair algorithm. Never overwrite the
original directory. Changes only winding, normals and removal of zero-area faces;
no vertex positions, proportions, material colours or part names are redesigned.
"""
from __future__ import annotations
import argparse,json,struct,hashlib
from pathlib import Path
from generate_visual_expansion import Asset,sub,cross,dot,mean

def read_glb(path):
    data=path.read_bytes()
    if data[:4]!=b'glTF': raise ValueError('Not a GLB: '+str(path))
    size=struct.unpack_from('<I',data,12)[0]
    document=json.loads(data[20:20+size]); binary=data[28+size:]
    return document,binary

def accessor(doc,binary,i):
    a=doc['accessors'][i];v=doc['bufferViews'][a['bufferView']]
    codes={5126:('f',4),5125:('I',4),5123:('H',2),5121:('B',1)}
    code,width=codes[a['componentType']]; components={'SCALAR':1,'VEC3':3,'VEC2':2,'VEC4':4}[a['type']]
    offset=v.get('byteOffset',0)+a.get('byteOffset',0);stride=v.get('byteStride',width*components)
    return [struct.unpack_from('<'+str(components)+code,binary,offset+j*stride) for j in range(a['count'])]

def main():
    root=Path(__file__).resolve().parents[1]
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',type=Path,default=root/'public/assets/models')
    parser.add_argument('--output',type=Path,default=root/'public/assets/models/winding-fixed-v1')
    args=parser.parse_args()
    if args.source.resolve()==args.output.resolve(): raise SystemExit('Refusing to overwrite source assets')
    reports=[]
    for path in sorted(args.source.glob('*.glb')):
        doc,binary=read_glb(path)
        if any(any(k in n for k in ('matrix','translation','rotation','scale','skin')) for n in doc['nodes']):
            raise ValueError('Unexpected transformed node; this targeted repair does not support it')
        asset=Asset(path.stem,'winding-corrected-original',None);flips=0;removed=0
        for mesh in doc['meshes']:
            for primitive in mesh['primitives']:
                positions=accessor(doc,binary,primitive['attributes']['POSITION'])
                indices=[x[0] for x in accessor(doc,binary,primitive['indices'])]
                centre=mean(positions);triangles=[]
                for start in range(0,len(indices),3):
                    a,b,c=(positions[j] for j in indices[start:start+3]);normal=cross(sub(b,a),sub(c,a))
                    if dot(normal,normal)<1e-18: removed+=1;continue
                    if dot(normal,sub(mean((a,b,c)),centre)) < -1e-12:
                        b,c=c,b;flips+=1
                    triangles.append((a,b,c))
                color=doc['materials'][primitive['material']]['pbrMetallicRoughness']['baseColorFactor']
                asset.triangles(mesh['name'],triangles,color)
        entry=asset.write(args.output)
        # Preserve every original material's roughness/metallicity, not defaults.
        newdoc,newbin=read_glb(args.output/path.name)
        oldmats=doc['materials']
        by_color={tuple(m['pbrMetallicRoughness']['baseColorFactor']):m for m in oldmats}
        for material in newdoc['materials']:
            color=tuple(material['pbrMetallicRoughness']['baseColorFactor'])
            old=by_color[color]['pbrMetallicRoughness']
            for name in ('metallicFactor','roughnessFactor'): material['pbrMetallicRoughness'][name]=old[name]
        raw=json.dumps(newdoc,sort_keys=True,separators=(',',':')).encode();raw+=b' '*((-len(raw))%4)
        payload=struct.pack('<4sII',b'glTF',2,28+len(raw)+len(newbin))+struct.pack('<I4s',len(raw),b'JSON')+raw+struct.pack('<I4s',len(newbin),b'BIN\0')+newbin
        (args.output/path.name).write_bytes(payload)
        entry.update(bytes=len(payload),sha256=hashlib.sha256(payload).hexdigest(),reversedFaces=flips,removedZeroAreaFaces=removed,
                     sourceSha256=hashlib.sha256(path.read_bytes()).hexdigest())
        reports.append(entry)
    (args.output/'manifest.json').write_text(json.dumps({'pack':'winding-fixed-v1','assets':reports,'scope':'Winding/normals only; geometry design defects and disconnected props remain.'},indent=2)+'\n')
    print(f'Wrote {len(reports)} corrected copies; reversed {sum(x["reversedFaces"] for x in reports)} faces; removed {sum(x["removedZeroAreaFaces"] for x in reports)} zero-area faces.')
if __name__=='__main__': main()
