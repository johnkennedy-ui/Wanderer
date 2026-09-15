#!/usr/bin/env python3
"""Deterministic, standard-library-only low-poly GLB expansion for Wanderer.
Run: python3 tools/generate_expansion.py [output-directory]
Default output is this handoff's public/assets/models/expansion-v1 directory.
No network access, external textures, random runtime state, or dependencies.
"""
from __future__ import annotations
import argparse, hashlib, json, math, random, struct
from pathlib import Path
from typing import Iterable

Vec = tuple[float, float, float]
PALETTE = {
    'forest': (.12,.27,.20,1), 'forest_light': (.19,.37,.23,1),
    'deep_forest': (.06,.13,.12,1), 'moss': (.28,.45,.22,1),
    'teal': (.14,.49,.47,1), 'pale_teal': (.43,.86,.78,1),
    'violet': (.48,.22,.70,1), 'ember': (.96,.28,.06,1),
    'gold': (.88,.57,.15,1), 'bronze': (.47,.25,.10,1),
    'silver': (.66,.74,.78,1), 'stone': (.34,.39,.39,1),
    'stone_light': (.47,.53,.52,1), 'charcoal': (.10,.12,.14,1),
    'wood': (.34,.18,.08,1), 'wood_cut': (.58,.37,.17,1),
    'leather': (.24,.12,.07,1), 'bone': (.77,.70,.52,1),
    'water': (.035,.21,.26,1), 'water_light': (.07,.31,.36,1),
    'water_foam': (.47,.70,.64,1), 'sand': (.40,.39,.23,1),
    'smoke': (.32,.35,.36,1),
}
def add(a: Vec,b: Vec)->Vec: return tuple(a[i]+b[i] for i in range(3))
def sub(a: Vec,b: Vec)->Vec: return tuple(a[i]-b[i] for i in range(3))
def mul(a: Vec,s: float)->Vec: return tuple(v*s for v in a)
def dot(a: Vec,b: Vec)->float: return sum(a[i]*b[i] for i in range(3))
def cross(a: Vec,b: Vec)->Vec: return (a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0])
def norm(a: Vec)->Vec:
    length=math.sqrt(dot(a,a))
    if length<1e-12: raise ValueError('Zero-length vector')
    return mul(a,1/length)
def mean(v: Iterable[Vec])->Vec:
    p=list(v)
    return tuple(sum(q[i] for q in p)/len(p) for i in range(3))
def rotate_y(p: Vec,a:float)->Vec:
    c,s=math.cos(a),math.sin(a)
    return (c*p[0]+s*p[2],p[1],-s*p[0]+c*p[2])

class Asset:
    def __init__(self,name:str,category:str,forward:Vec|None=None):
        self.name,self.category,self.forward=name,category,forward
        self.parts=[]
    def part(self,name,vertices,faces,color, *, convex=True,emissive=None):
        vertices=[tuple(v) for v in vertices]
        centre=mean(vertices)
        triangles=[]
        for f in faces:
            a,b,c=(vertices[i] for i in f)
            n=cross(sub(b,a),sub(c,a))
            if dot(n,n)<1e-18: continue
            if convex and dot(n,sub(mean((a,b,c)),centre))<0: b,c=c,b
            triangles.append((a,b,c))
        self.triangles(name,triangles,color,emissive=emissive)
    def triangles(self,name,triangles,color, *,emissive=None):
        rgba=tuple(PALETTE[color] if isinstance(color,str) else color)
        positions=[]; normals=[]
        for a,b,c in triangles:
            n=cross(sub(b,a),sub(c,a))
            if dot(n,n)<1e-18: continue
            n=norm(n)
            for v in (a,b,c): positions.extend(v); normals.extend(n)
        if positions: self.parts.append((name,positions,normals,rgba,emissive))
    def write(self,directory:Path):
        directory.mkdir(parents=True,exist_ok=True)
        blob=bytearray(); views=[]; access=[]; meshes=[]; nodes=[]; materials=[]
        material_ids={}
        def acc(values,components,typ,component=5126):
            while len(blob)%4: blob.append(0)
            offset=len(blob); code='f' if component==5126 else 'I'
            blob.extend(struct.pack('<'+str(len(values))+code,*values))
            views.append({'buffer':0,'byteOffset':offset,'byteLength':len(blob)-offset})
            item={'bufferView':len(views)-1,'componentType':component,'count':len(values)//components,'type':typ}
            if component==5126 and typ=='VEC3':
                # Compute bounds after float32 packing, not Python double rounding.
                packed=struct.unpack_from('<'+str(len(values))+'f',blob,offset)
                item['min']=[min(packed[i::components]) for i in range(components)]
                item['max']=[max(packed[i::components]) for i in range(components)]
            access.append(item); return len(access)-1
        for name,positions,normals,color,emissive in self.parts:
            key=(color,tuple(emissive) if emissive else None)
            if key not in material_ids:
                material_ids[key]=len(materials)
                mat={'name':'material_'+str(len(materials)),'pbrMetallicRoughness':{
                    'baseColorFactor':list(color),'roughnessFactor':.86,'metallicFactor':.02},'doubleSided':False}
                if emissive: mat['emissiveFactor']=list(emissive)
                materials.append(mat)
            primitive={'attributes':{'POSITION':acc(positions,3,'VEC3'),'NORMAL':acc(normals,3,'VEC3')},
                       'indices':acc(list(range(len(positions)//3)),1,'SCALAR',5125),'material':material_ids[key],'mode':4}
            meshes.append({'name':name,'primitives':[primitive]}); nodes.append({'name':name,'mesh':len(meshes)-1})
        document={'asset':{'version':'2.0','generator':'Wanderer expansion-v1 deterministic generator'},'scene':0,
            'scenes':[{'nodes':list(range(len(nodes)))}], 'nodes':nodes,'meshes':meshes,'materials':materials,
            'buffers':[{'byteLength':len(blob)}],'bufferViews':views,'accessors':access,
            'extras':{'upAxis':'+Y','category':self.category,'forward':self.forward,'static':True}}
        encoded=json.dumps(document,sort_keys=True,separators=(',',':')).encode()
        encoded+=b' '*((-len(encoded))%4); blob+=b'\0'*((-len(blob))%4)
        payload=struct.pack('<4sII',b'glTF',2,28+len(encoded)+len(blob))+struct.pack('<I4s',len(encoded),b'JSON')+encoded+struct.pack('<I4s',len(blob),b'BIN\0')+blob
        path=directory/(self.name+'.glb');path.write_bytes(payload)
        v=[p[i:i+3] for _,p,_,_,_ in self.parts for i in range(0,len(p),3)]
        return {'id':self.name,'file':path.name,'category':self.category,'forward':list(self.forward) if self.forward else None,
            'bounds':{'min':[min(x[i] for x in v) for i in range(3)],'max':[max(x[i] for x in v) for i in range(3)]},
            'triangles':sum(len(p)//9 for _,p,_,_,_ in self.parts),'meshCount':len(self.parts),
            'sha256':hashlib.sha256(payload).hexdigest(),'bytes':len(payload),'static':True,
            'animationClips':[],'collision':'presentation-only; inherit existing domain obstacle or none'}

def box(a,name,size,color,centre=(0,0,0),yaw=0):
    x,y,z=(s/2 for s in size)
    vertices=[add(rotate_y(p,yaw),centre) for p in [(-x,-y,-z),(x,-y,-z),(x,y,-z),(-x,y,-z),(-x,-y,z),(x,-y,z),(x,y,z),(-x,y,z)]]
    faces=[(0,1,2),(0,2,3),(4,7,6),(4,6,5),(0,4,5),(0,5,1),(3,2,6),(3,6,7),(1,5,6),(1,6,2),(0,3,7),(0,7,4)]
    a.part(name,vertices,faces,color)
def tube(a,name,p0,p1,r0,r1,color,sides=7):
    direction=norm(sub(p1,p0)); helper=(0,1,0) if abs(direction[1])<.9 else (1,0,0)
    u=norm(cross(direction,helper));v=cross(direction,u)
    vertices=[add(p,mul(add(mul(u,math.cos(i*math.tau/sides)),mul(v,math.sin(i*math.tau/sides))),r)) for p,r in ((p0,r0),(p1,r1)) for i in range(sides)]
    vertices.extend([p0,p1]); faces=[]
    for i in range(sides):
        k=(i+1)%sides
        faces.extend([(i,k,sides+k),(i,sides+k,sides+i),(2*sides,k,i),(2*sides+1,sides+i,sides+k)])
    a.part(name,vertices,faces,color)
def gem(a,name,centre,size,color,seed=0,jitter=.0):
    p=(1+math.sqrt(5))/2; raw=[(-1,p,0),(1,p,0),(-1,-p,0),(1,-p,0),(0,-1,p),(0,1,p),(0,-1,-p),(0,1,-p),(p,0,-1),(p,0,1),(-p,0,-1),(-p,0,1)]
    rng=random.Random(seed); vertices=[]
    for v in raw:
        q=norm(v); scale=1+rng.uniform(-jitter,jitter)
        vertices.append(add(tuple(q[i]*size[i]*scale for i in range(3)),centre))
    faces=[(0,11,5),(0,5,1),(0,1,7),(0,7,10),(0,10,11),(1,5,9),(5,11,4),(11,10,2),(10,7,6),(7,1,8),(3,9,4),(3,4,2),(3,2,6),(3,6,8),(3,8,9),(4,9,5),(2,4,11),(6,2,10),(8,6,7),(9,8,1)]
    a.part(name,vertices,faces,color)
def plane(a,name,width,depth,y,color):
    a.part(name,[(-width/2,y,-depth/2),(width/2,y,-depth/2),(width/2,y,depth/2),(-width/2,y,depth/2)],[(0,2,1),(0,3,2)],color,convex=False)
def arc(a,name,inner,outer,start,end,y,color,segments=16):
    vertices=[]
    for i in range(segments+1):
        t=start+(end-start)*i/segments
        for r in (inner,outer): vertices.append((math.sin(t)*r,y,-math.cos(t)*r))
    faces=[]
    for i in range(segments):
        f=(2*i,2*i+1,2*i+3);g=(2*i,2*i+3,2*i+2)
        for inds in (f,g):
            a0,b,c=(vertices[x] for x in inds)
            faces.append(inds if cross(sub(b,a0),sub(c,a0))[1]>0 else (inds[0],inds[2],inds[1]))
    a.part(name,vertices,faces,color,convex=False)

def build_assets():
    assets=[]
    for i,(name,size,color) in enumerate([
        ('rock_granite_a',(.48,.40,.41),'stone'),('rock_granite_b',(.37,.63,.36),'stone_light'),
        ('rock_granite_c',(.62,.27,.45),'charcoal'),('rock_moss_a',(.50,.43,.42),'stone'),
        ('rock_ore_bronze',(.46,.48,.39),'charcoal')]):
        a=Asset(name,'rock');gem(a,'rock',(0,size[1]*.85,0),size,color,seed=i+12,jitter=.13)
        if 'moss' in name:
            gem(a,'moss_cap',(-.05,.63,.01),(.36,.13,.30),'moss',seed=44,jitter=.15)
        if 'ore' in name:
            for j in range(3): gem(a,'ore_'+str(j),(-.19+j*.17,.53+j*.07,-.15),(.14,.21,.11),'bronze' if j!=1 else 'gold')
        assets.append(a)
    for i in range(2):
        a=Asset('tree_pine_'+('a' if i==0 else 'b'),'tree');h=2.6+i*.50
        tube(a,'trunk',(0,0,0),(0,h*.85,0),.13,.065,'wood',7)
        for j in range(3):
            bottom=.56+j*.50+ i*.08
            tube(a,'canopy_'+str(j),(0,bottom,0),(0,bottom+1.1+i*.16,0),.84-j*.18,0,['forest','forest_light','moss'][j],7)
        assets.append(a)
    for i in range(2):
        a=Asset('tree_broadleaf_'+('a' if i==0 else 'b'),'tree');h=1.65+i*.30
        tube(a,'trunk',(0,0,0),(.08,h,0),.16,.08,'wood')
        for j,(x,z,s) in enumerate([(-.48,-.12,.66),(.48,.12,.72),(0,.39,.68),(0,-.10,.82)]):
            tube(a,'branch_'+str(j),(0,h*.62,0),(x,h+.04*j,z),.065,.025,'wood',5)
            gem(a,'canopy_'+str(j),(x,h+.25+.12*j,z),(s,.58,s),['forest','forest_light','moss','forest_light'][j],seed=100+i*10+j,jitter=.08)
        assets.append(a)
    a=Asset('tree_dead_a','tree');tube(a,'trunk',(0,0,0),(.08,2.15,-.04),.17,.045,'wood')
    for j,(p,q) in enumerate([((0,.75,0),(-.55,1.35,.04)),((.03,1.22,0),(.65,1.65,-.07)),((.02,1.4,0),(-.34,1.95,.30))]):tube(a,'branch_'+str(j),p,q,.08,.012,'wood',5)
    assets.append(a)
    a=Asset('stump_a','prop');tube(a,'bark',(0,0,0),(0,.42,0),.30,.25,'wood');tube(a,'cut',(0,.42,0),(0,.44,0),.235,.235,'wood_cut')
    for j in range(3):
        t=j*math.tau/3;tube(a,'root_'+str(j),(0,.12,0),(.43*math.cos(t),.04,.43*math.sin(t)),.12,.04,'wood',5)
    assets.append(a)
    a=Asset('fallen_log_a','prop');tube(a,'bark',(-.9,.20,0),(.9,.20,0),.21,.18,'wood');tube(a,'cut',(.90,.20,0),(.915,.20,0),.155,.155,'wood_cut');gem(a,'moss',(-.15,.39,0),(.50,.095,.13),'moss');assets.append(a)
    a=Asset('bush_a','foliage')
    for j,(x,z,s) in enumerate([(-.28,0,.37),(.25,.03,.39),(0,-.13,.42)]):gem(a,'leaves_'+str(j),(x,.31,z),(s,.36,s),['forest','moss','forest_light'][j],seed=j,jitter=.08)
    assets.append(a)
    a=Asset('reeds_a','foliage')
    for j in range(6):
        x=(j%3-1)*.15;z=(j//3-.5)*.21;h=.60+(j%3)*.16
        tube(a,'stem_'+str(j),(x,0,z),(x+.06,h,z),.015,.009,'moss',5)
        tube(a,'head_'+str(j),(x+.06,h-.13,z),(x+.06,h+.06,z),.047,.04,'wood',5)
    assets.append(a)
    a=Asset('water_tile_4m','water');plane(a,'water_surface',4,4,.035,'water')
    for j in range(5):
        x=-1.4+j*.67;z=((j*7)%5-2)*.54
        box(a,'ripple_'+str(j),(.38,.006,.035),'water_light',(x,.043,z),.2)
    assets.append(a)
    a=Asset('water_pond_small','water')
    sides=24;points=[(0,.035,0)]+[(math.cos(j*math.tau/sides)*1.4*(1+.06*math.sin(j*1.7)),.035,math.sin(j*math.tau/sides)*1.05*(1+.08*math.cos(j*1.3))) for j in range(sides)]
    a.part('water_surface',points,[(0,(j+1)%sides+1,j+1) for j in range(sides)],'water',convex=False)
    for j in range(3):arc(a,'ripples_'+str(j),.30+j*.23,.32+j*.23,-1.0,1.0,.04,'water_light',12)
    assets.append(a)
    a=Asset('water_shore_strip','water');plane(a,'shore',4,.48,.025,'sand');box(a,'wet_edge',(4,.015,.11),'water_light',(0,.04,-.22));assets.append(a)
    a=Asset('water_ripple_ring','effect');arc(a,'ripple',.35,.39,0,math.tau,.02,'water_foam',24);assets.append(a)
    a=Asset('projectile_arrow_v2','projectile',(0,0,-1))
    tube(a,'shaft',(0,0,.56),(0,0,-.47),.026,.026,'wood',6)
    tube(a,'arrowhead',(0,0,-.44),(0,0,-.76),.115,0,'silver',5)
    for j in range(3):
        angle=j*math.tau/3
        # Narrow solid fletching fins around the longitudinal Z axis.
        p=[(-.018,0,.47),(.018,0,.47),(-.018,.15,.53),(.018,.15,.53),(-.018,0,.22),(.018,0,.22)]
        verts=[(x*math.cos(angle)-y*math.sin(angle),x*math.sin(angle)+y*math.cos(angle),z) for x,y,z in p]
        a.part('fletching_'+str(j),verts,[(0,2,4),(1,5,3),(0,1,3),(0,3,2),(2,3,5),(2,5,4),(0,4,5),(0,5,1)],'teal')
    assets.append(a)
    a=Asset('projectile_flame_orb_v2','projectile',(0,0,-1));gem(a,'core',(0,0,-.13),(.23,.23,.28),'ember');gem(a,'hot_core',(0,.04,-.28),(.13,.13,.15),'gold')
    for j in range(3):
        x=(j-1)*.11;tube(a,'trail_'+str(j),(x,0,.04),(x*.7,.04,.52+j*.04),.08,0,'pale_teal',5)
    assets.append(a)
    a=Asset('projectile_toxic_spit','projectile',(0,0,-1));gem(a,'sac',(0,0,-.10),(.17,.15,.25),'violet');gem(a,'core',(0,.07,-.19),(.085,.075,.12),'teal')
    for j in range(3):gem(a,'droplet_'+str(j),((j%2-.5)*.14,0,.22+j*.16),(.055,.055,.08),'violet')
    assets.append(a)
    a=Asset('projectile_ember_bolt','projectile',(0,0,-1));gem(a,'head',(0,0,-.22),(.14,.13,.24),'gold');tube(a,'flame',(0,0,-.15),(0,0,.55),.17,0,'ember',6);assets.append(a)
    a=Asset('fx_blade_arc_v2','effect',(0,0,-1));arc(a,'slash',.67,.88,-1.04,1.04,0,'silver',20);arc(a,'ember_edge',.88,.925,-.90,.80,.003,'ember',18);assets.append(a)
    a=Asset('fx_impact_sparks','effect')
    for j in range(7):
        t=j*math.tau/7;gem(a,'spark_'+str(j),(.24*math.cos(t),.10+(j%3)*.08,.24*math.sin(t)),(.045,.12,.045),'gold' if j%2 else 'ember')
    assets.append(a)
    a=Asset('fx_smoke_puff','effect')
    for j in range(4):gem(a,'puff_'+str(j),((j%2-.5)*.19,.18+j*.11,(j//2-.5)*.15),(.22,.21,.21),'smoke',seed=j,jitter=.08)
    assets.append(a)
    return assets

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('output',nargs='?',type=Path,default=Path(__file__).resolve().parents[1]/'public/assets/models/expansion-v1');args=parser.parse_args()
    entries=[a.write(args.output) for a in build_assets()]
    manifest={'pack':'wanderer-expansion-v1','version':1,'upAxis':'+Y','units':'metres','static':True,
        'notes':'New meshes only; no built-in animation. Water is a flat opaque visual treatment, not collision terrain.',
        'assets':entries}
    (args.output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    print(f'Generated {len(entries)} GLB files; {sum(x["triangles"] for x in entries)} triangles; {sum(x["bytes"] for x in entries)} bytes.')
if __name__=='__main__': main()
