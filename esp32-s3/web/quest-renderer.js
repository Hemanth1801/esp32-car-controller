(function(root){
  'use strict';
  const multiply=(a,b)=>{const out=new Float32Array(16);for(let c=0;c<4;c++)for(let r=0;r<4;r++)for(let k=0;k<4;k++)out[c*4+r]+=a[k*4+r]*b[c*4+k];return out};
  const translate=(x,y,z)=>new Float32Array([1,0,0,0,0,1,0,0,0,0,1,0,x,y,z,1]);
  const scale=(x,y,z)=>new Float32Array([x,0,0,0,0,y,0,0,0,0,z,0,0,0,0,1]);
  const rx=a=>{const c=Math.cos(a),s=Math.sin(a);return new Float32Array([1,0,0,0,0,c,s,0,0,-s,c,0,0,0,0,1])};
  const ry=a=>{const c=Math.cos(a),s=Math.sin(a);return new Float32Array([c,0,-s,0,0,1,0,0,s,0,c,0,0,0,0,1])};
  const rz=a=>{const c=Math.cos(a),s=Math.sin(a);return new Float32Array([c,s,0,0,-s,c,0,0,0,0,1,0,0,0,0,1])};
  const pose=(x,y,z,sx=1,sy=1,sz=1,ax=0,ay=0,az=0)=>multiply(translate(x,y,z),multiply(ry(ay),multiply(rx(ax),multiply(rz(az),scale(sx,sy,sz)))));
  const normal=v=>{const d=Math.hypot(...v)||1;return v.map(n=>n/d)};
  const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
  const colors={carbon:[.62,.65,.69,1],black:[.12,.13,.15,1],rubber:[.13,.14,.15,1],metal:[.64,.67,.70,1],red:[.62,.035,.055,1],orange:[.95,.21,.055,1],white:[.88,.91,.92,1],green:[.16,.85,.6,1],suede:[.48,.50,.53,1],glass:[.17,.23,.28,1]};
  const identity=()=>translate(0,0,0);
  // All models use orthogonal rotation/scale. Inverse scale keeps bevel lighting
  // correct on a wide dashboard or a thin trim piece.
  const normalMatrix=m=>{const out=[];for(const i of [0,4,8]){const d=m[i]**2+m[i+1]**2+m[i+2]**2||1;out.push(m[i]/d,m[i+1]/d,m[i+2]/d)}return out};
  function plane(){return [-.5,-.5,0,0,0,1,0,0,.5,-.5,0,0,0,1,1,0,-.5,.5,0,0,0,1,0,1,-.5,.5,0,0,0,1,0,1,.5,-.5,0,0,0,1,1,0,.5,.5,0,0,0,1,1,1]}
  function box(){
    const out=[],faces=[[[0,0,1],[-1,-1,1],[1,-1,1],[-1,1,1],[1,1,1]],[[0,0,-1],[1,-1,-1],[-1,-1,-1],[1,1,-1],[-1,1,-1]],[[1,0,0],[1,-1,1],[1,-1,-1],[1,1,1],[1,1,-1]],[[-1,0,0],[-1,-1,-1],[-1,-1,1],[-1,1,-1],[-1,1,1]],[[0,1,0],[-1,1,1],[1,1,1],[-1,1,-1],[1,1,-1]],[[0,-1,0],[-1,-1,-1],[1,-1,-1],[-1,-1,1],[1,-1,1]]];
    for(const [n,a,b,c,d] of faces)for(const [p,uv] of [[a,[0,0]],[b,[1,0]],[c,[0,1]],[c,[0,1]],[b,[1,0]],[d,[1,1]]])out.push(...p.map(v=>v*.5),...n,...uv);return out;
  }
  function roundedBox(){
    const out=[],steps=8,r=.16,point=(axis,sign,u,v)=>{
      const p=axis===0?[sign*.5,u,v]:axis===1?[u,sign*.5,v]:[u,v,sign*.5];
      const core=p.map(a=>Math.max(-.5+r,Math.min(.5-r,a))),n=normal(p.map((a,i)=>a-core[i]));
      return [...core.map((a,i)=>a+n[i]*r),...n,u+.5,v+.5];
    };
    for(let axis=0;axis<3;axis++)for(const sign of [-1,1])for(let y=0;y<steps;y++)for(let x=0;x<steps;x++){
      const u=x/steps-.5,v=y/steps-.5,d=1/steps;
      for(const [a,b] of [[u,v],[u+d,v],[u,v+d],[u,v+d],[u+d,v],[u+d,v+d]])out.push(...point(axis,sign,a,b));
    }return out;
  }
  function dashShell(){
    // Upholstered dash: a continuous sculpted surface rather than stacked boxes.
    const out=[],across=48,depth=12,vertex=(i,j)=>{
      const x=(i/across-.5)*1.92,t=j/depth,z=-1.65+t*.65;
      const y=-.32-.17*t+.045*Math.sin(t*Math.PI)-.035*(x*x);
      return [x,y,z,...normal([.07*x,1,.17/.65-.045*Math.PI/.65*Math.cos(t*Math.PI)]),(x+.96)*8,t*5];
    };
    for(let i=0;i<across;i++)for(let j=0;j<depth;j++)for(const [a,b] of [[i,j],[i+1,j],[i,j+1],[i,j+1],[i+1,j],[i+1,j+1]])out.push(...vertex(a,b));
    // Rolled leading edge; local normals follow the padded curve.
    for(let i=0;i<across;i++)for(let j=0;j<8;j++){
      const v=(a,b)=>{const x=(a/across-.5)*1.92,q=b/8*Math.PI/2;return [x,-.49-.035*x*x-.09*(1-Math.cos(q)),-1.0+.09*Math.sin(q),0,Math.cos(q),Math.sin(q),(x+.96)*8,b/8]};
      for(const [a,b] of [[i,j],[i+1,j],[i,j+1],[i,j+1],[i+1,j],[i+1,j+1]])out.push(...v(a,b));
    }return out;
  }
  function cylinder(segments=24){
    const out=[],point=(a,y)=>[Math.cos(a),y,Math.sin(a)],v=(p,n,uv)=>out.push(...p,...n,...uv);
    for(let i=0;i<segments;i++){
      const a=i/segments*Math.PI*2,b=(i+1)/segments*Math.PI*2,na=[Math.cos(a),0,Math.sin(a)],nb=[Math.cos(b),0,Math.sin(b)];
      for(const [p,n,u] of [[point(a,-.5),na,0],[point(b,-.5),nb,1],[point(a,.5),na,0],[point(a,.5),na,0],[point(b,-.5),nb,1],[point(b,.5),nb,1]])v(p,n,[u,p[1]+.5]);
      for(const y of [-.5,.5])for(const p of [[0,y,0],point(a,y),point(b,y)])v(p,[0,Math.sign(y),0],[(p[0]+1)/2,(p[2]+1)/2]);
    }return out;
  }
  function wheelRim(){
    const out=[],around=96,tube=12;
    const vertex=(i,j)=>{const a=i/around*Math.PI*2,b=j/tube*Math.PI*2,c=Math.cos(a),s=Math.sin(a),flat=s<-.66,px=c*.92,py=Math.max(-.61,s*.92),nx=flat?0:c,ny=flat?-1:s,n=[nx*Math.cos(b),ny*Math.cos(b),Math.sin(b)];return [px+nx*Math.cos(b)*.105,py+ny*Math.cos(b)*.105,Math.sin(b)*.105,...n,i/around,j/tube]};
    for(let i=0;i<around;i++)for(let j=0;j<tube;j++)for(const [a,b] of [[i,j],[i+1,j],[i,j+1],[i,j+1],[i+1,j],[i+1,j+1]])out.push(...vertex(a,b));return out;
  }
  class CockpitRenderer{
    constructor(canvas){
      this.canvas=canvas;const g=this.gl=canvas.getContext('webgl',{antialias:true,alpha:false,xrCompatible:true});
      if(!g)throw Error('WebGL is unavailable. Enable hardware acceleration to preview the cockpit.');
      const shader=(type,source)=>{const s=g.createShader(type);g.shaderSource(s,source);g.compileShader(s);if(!g.getShaderParameter(s,g.COMPILE_STATUS))throw Error('Cockpit shader failed');return s};
      this.program=g.createProgram();
      g.attachShader(this.program,shader(g.VERTEX_SHADER,`
        attribute vec3 position; attribute vec3 normal; attribute vec2 texCoord;
        uniform mat4 matrix; uniform mat4 model; uniform mat3 normals; uniform vec2 uvScale; uniform vec2 uvFlip;
        varying vec2 uv; varying vec3 faceNormal; varying vec3 world;
        void main(){uv=((texCoord-0.5)*uvFlip+0.5)*uvScale;faceNormal=normalize(normals*normal);
          world=(model*vec4(position,1.0)).xyz;gl_Position=matrix*vec4(position,1.0);}`));
      g.attachShader(this.program,shader(g.FRAGMENT_SHADER,`
        precision mediump float;
        varying vec2 uv; varying vec3 faceNormal; varying vec3 world;
        uniform sampler2D image; uniform vec4 tint; uniform float lit;
        uniform vec3 eye; uniform vec2 surface;
        void main(){
          vec4 tex=texture2D(image,uv)*tint;
          if(lit<0.5){gl_FragColor=tex;return;}
          vec3 n=normalize(faceNormal),v=normalize(eye-world);
          if(dot(n,v)<0.0)n=-n;
          vec3 key=normalize(vec3(-0.55,1.0,-0.8)),fill=normalize(vec3(1.0,0.35,0.15));
          float rough=surface.x,metal=surface.y,ndv=max(dot(n,v),0.0);
          vec3 base=pow(max(tex.rgb,vec3(0.001)),vec3(2.2));
          vec3 ambient=mix(vec3(0.10,0.115,0.14),vec3(0.48,0.55,0.63),n.y*0.5+0.5);
          vec3 lighting=ambient+vec3(1.0,0.93,0.81)*max(dot(n,key),0.0)*0.85
            +vec3(0.53,0.66,0.83)*max(dot(n,fill),0.0)*0.38;
          float spec=pow(max(dot(n,normalize(key+v)),0.0),mix(140.0,7.0,rough));
          float edge=pow(1.0-ndv,5.0);
          vec3 f0=mix(vec3(0.035),base,metal);
          vec3 reflected=mix(vec3(0.12,0.15,0.20),vec3(0.7,0.79,0.88),max(reflect(-v,n).y,0.0));
          vec3 color=base*lighting*(1.0-metal*0.55)
            +f0*spec*(1.6-rough)+reflected*(f0+edge*(1.0-f0))*(1.0-rough)*0.45;
          gl_FragColor=vec4(pow(color/(color+vec3(0.82)),vec3(1.0/2.2)),tex.a);
        }`));
      g.linkProgram(this.program);if(!g.getProgramParameter(this.program,g.LINK_STATUS))throw Error('Cockpit shader link failed');
      this.attributes=Object.fromEntries(['position','normal','texCoord'].map(name=>[name,g.getAttribLocation(this.program,name)]));
      this.uniforms=Object.fromEntries(['matrix','model','normals','uvScale','uvFlip','tint','lit','eye','surface'].map(name=>[name,g.getUniformLocation(this.program,name)]));
      this.meshes={plane:this.mesh(plane()),box:this.mesh(box()),rounded:this.mesh(roundedBox()),dash:this.mesh(dashShell()),cylinder:this.mesh(cylinder()),rim:this.mesh(wheelRim())};
      this.white=this.texture();g.texImage2D(g.TEXTURE_2D,0,g.RGBA,1,1,0,g.RGBA,g.UNSIGNED_BYTE,new Uint8Array([255,255,255,255]));
      for(const name of ['video','hud','blank','practiceTexture','dashTexture','wheelTexture','carbon','banner','switchTexture','leather','alcantara','brushed','mirror'])this[name]=this.texture();
      this.practiceCanvas=this.canvas2d(1280,720);this.hudCanvas=this.canvas2d(1024,650);this.dashCanvas=this.canvas2d(1024,440);this.wheelCanvas=this.canvas2d(512,256);
      this.practiceDistance=0;this.lastPractice=0;this.lastHud=-Infinity;this.lastWheelAngle=0;
      this.videoFlip=[1,1];
      this.makeMaterials();this.parts=[];this.makeCabin();this.bakeCabin();this.staticDrawCalls=this.parts.length;
      canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();canvas.dispatchEvent(new Event('cockpitlost'))});
    }
    canvas2d(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c}
    mesh(vertices){const g=this.gl,buffer=g.createBuffer(),data=new Float32Array(vertices);g.bindBuffer(g.ARRAY_BUFFER,buffer);g.bufferData(g.ARRAY_BUFFER,data,g.STATIC_DRAW);return {buffer,count:data.length/8,data}}
    texture(){const g=this.gl,t=g.createTexture();g.bindTexture(g.TEXTURE_2D,t);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MIN_FILTER,g.LINEAR);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MAG_FILTER,g.LINEAR);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_S,g.CLAMP_TO_EDGE);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_T,g.CLAMP_TO_EDGE);return t}
    upload(texture,source){const g=this.gl;g.bindTexture(g.TEXTURE_2D,texture);g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL,true);g.texImage2D(g.TEXTURE_2D,0,g.RGBA,g.RGBA,g.UNSIGNED_BYTE,source)}
    updateVideo(bitmap){this.videoAspect=bitmap.width/bitmap.height;this.upload(this.video,bitmap)}
    setVideoOrientation(mode){this.videoFlip=root.RCCameraOrientation.flips(mode)}
    makeMaterials(){
      let c=this.canvas2d(256,256),x=c.getContext('2d');x.fillStyle='#44484e';x.fillRect(0,0,256,256);
      // Small twill strands, rather than a large checkerboard.
      for(let y=0;y<256;y+=8)for(let a=0;a<256;a+=8){const flip=((a/8+y/8)%4)<2;
        x.fillStyle=flip?'#686c73':'#45494f';x.fillRect(a,y,8,8);
        for(let k=0;k<8;k++){x.fillStyle=`rgba(${flip?'180,187,195':'18,20,24'},${k%3===0?.24:.08})`;x.fillRect(a+(flip?0:k),y+(flip?k:0),flip?8:1,flip?1:8)}
      }
      const repeat=texture=>{const g=this.gl;this.upload(texture,c);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_S,g.REPEAT);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_T,g.REPEAT);g.generateMipmap(g.TEXTURE_2D);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MIN_FILTER,g.LINEAR_MIPMAP_LINEAR);
        const anisotropic=g.getExtension('EXT_texture_filter_anisotropic');if(anisotropic)g.texParameterf(g.TEXTURE_2D,anisotropic.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(4,g.getParameter(anisotropic.MAX_TEXTURE_MAX_ANISOTROPY_EXT)))};
      repeat(this.carbon);
      let seed=53;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296};
      for(const [texture,base,amount] of [[this.leather,80,18],[this.alcantara,82,10],[this.brushed,166,35]]){
        const pixels=x.createImageData(256,256);
        for(let y=0;y<256;y++)for(let a=0;a<256;a++){
          const grain=texture===this.brushed?(random()-.5)*8+Math.sin(y*4.2)*amount:(random()-.5)*amount;
          const at=(y*256+a)*4;pixels.data[at]=base+grain;pixels.data[at+1]=base+grain+2;pixels.data[at+2]=base+grain+5;pixels.data[at+3]=255;
        }x.putImageData(pixels,0,0);repeat(texture);
      }
      c=this.canvas2d(1024,100);x=c.getContext('2d');x.fillStyle='#17191d';x.fillRect(0,0,1024,100);x.fillStyle='#a2212b';x.fillRect(0,94,1024,3);x.fillStyle='#e0e2e2';x.textAlign='center';x.font='italic 600 37px system-ui';x.fillText('E S P   /   M O T O R S P O R T',512,67);this.upload(this.banner,c);
      c=this.canvas2d(256,128);x=c.getContext('2d');const glass=x.createLinearGradient(0,0,0,128);glass.addColorStop(0,'#77858d');glass.addColorStop(.48,'#46545e');glass.addColorStop(.52,'#242e37');glass.addColorStop(1,'#141c25');x.fillStyle=glass;x.fillRect(0,0,256,128);x.fillStyle='#ffffff14';x.beginPath();x.moveTo(0,20);x.lineTo(256,0);x.lineTo(256,25);x.lineTo(0,85);x.fill();this.upload(this.mirror,c);
      c=this.canvas2d(960,540);x=c.getContext('2d');x.fillStyle='#18202b';x.fillRect(0,0,960,540);x.fillStyle='#ff777d';x.textAlign='center';x.font='bold 36px system-ui';x.fillText('CAMERA SIGNAL LOST',480,260);x.fillStyle='#c2cbd4';x.font='24px system-ui';x.fillText('Live car stays disarmed until video returns',480,306);this.upload(this.blank,c);
      c=this.canvas2d(512,256);x=c.getContext('2d');x.fillStyle='#191c21';x.fillRect(0,0,512,256);x.strokeStyle='#484d55';x.lineWidth=2;x.strokeRect(10,10,492,236);x.fillStyle='#c3c7cb';x.textAlign='center';x.font='500 18px system-ui';x.fillText('IGNITION     •     RADIO     •     LIGHTS',256,53);x.fillText('MAP  /  A',104,145);x.fillText('STOP  /  B',385,145);x.fillStyle='#858a91';x.font='16px system-ui';x.fillText('ESP / MOTORSPORT',256,225);this.upload(this.switchTexture,c);
      this.skyCanvas=this.canvas2d(1280,400);x=this.skyCanvas.getContext('2d');
      const sky=x.createLinearGradient(0,0,0,400);sky.addColorStop(0,'#496980');sky.addColorStop(.65,'#aebec2');sky.addColorStop(1,'#deddd1');x.fillStyle=sky;x.fillRect(0,0,1280,400);
      for(let i=0;i<32;i++){const px=random()*1450-85,py=60+random()*230,r=45+random()*130,cloud=x.createRadialGradient(px,py,0,px,py,r);cloud.addColorStop(0,'#ffffff26');cloud.addColorStop(1,'#ffffff00');x.save();x.translate(0,py*.6);x.scale(1,.4);x.fillStyle=cloud;x.fillRect(px-r,py-r,r*2,r*2);x.restore()}
      this.roadGrain=this.canvas2d(256,256);x=this.roadGrain.getContext('2d');const grain=x.createImageData(256,256);
      for(let i=0;i<grain.data.length;i+=4){const value=75+random()*65;grain.data[i]=value;grain.data[i+1]=value;grain.data[i+2]=value;grain.data[i+3]=90}x.putImageData(grain,0,0);
    }
    add(mesh,model,color=colors.black,texture=this.white,lit=1,uv=[1,1]){this.parts.push({mesh:this.meshes[mesh],model,color,texture,lit,uv})}
    solid(x,y,z,w,h,d,color=colors.black,texture=this.white,ax=0,ay=0,az=0){this.add('box',pose(x,y,z,w,h,d,ax,ay,az),color,texture,1,texture===this.carbon?[7,4]:[1,1])}
    padded(x,y,z,w,h,d,color=colors.black,texture=this.leather,ax=0,ay=0,az=0){this.add('rounded',pose(x,y,z,w,h,d,ax,ay,az),color,texture,1,texture===this.carbon?[5,3]:texture===this.leather||texture===this.alcantara?[4,3]:[1,1])}
    rodModel(a,b,r){const y=normal(b.map((v,i)=>v-a[i])),x=normal(cross(y,Math.abs(y[1])>.9?[1,0,0]:[0,1,0])),z=cross(x,y),length=Math.hypot(...b.map((v,i)=>v-a[i]));return new Float32Array([x[0]*r,x[1]*r,x[2]*r,0,y[0]*length,y[1]*length,y[2]*length,0,z[0]*r,z[1]*r,z[2]*r,0,...a.map((v,i)=>(v+b[i])/2),1])}
    tube(a,b,r,color=colors.red){this.add('cylinder',this.rodModel(a,b,r),color)}
    makeCabin(){
      // Metres from the seated driver's head. The windshield stays unobstructed;
      // its image is the real front camera, not a simulated rear/side camera.
      this.padded(0,-1.04,-.18,1.92,.10,3.3,colors.black,this.alcantara);
      this.padded(0,.83,-.10,1.96,.12,2.95,colors.suede,this.alcantara);
      this.add('dash',identity(),colors.suede,this.alcantara);
      this.padded(0,-.62,-1.16,1.91,.25,.45,colors.black,this.leather);
      this.padded(0,-.56,-.94,1.87,.075,.055,colors.carbon,this.carbon);
      this.padded(0,-.595,-.908,1.86,.008,.012,colors.metal,this.brushed);
      // Double seam across the rolled dashboard lip.
      for(let i=0;i<58;i++)for(const y of [-.468,-.479])this.tube([-.91+i*.032,y,-.907],[-.893+i*.032,y,-.907],.0009,[.55,.38,.34,1]);
      this.padded(0,-.325,-1.60,1.75,.035,.045,colors.black,this.leather);
      for(const side of [-1,1]){
        // Smoked side glazing catches light. It does not duplicate the front feed
        // or imply that this single-camera car has side/rear camera coverage.
        const points=[[side*1.105,-.29,-1.48],[side*1.01,-.27,.32],[side*.98,.68,.32],[side*.966,.68,-1.49]],glass=[];
        for(const [i,u,v] of [[0,0,0],[1,1,0],[2,1,1],[0,0,0],[2,1,1],[3,0,1]])glass.push(...points[i],-side,0,0,u,v);
        this.parts.push({mesh:this.mesh(glass),model:identity(),color:[.27,.30,.33,1],texture:this.mirror,lit:1,uv:[1,1]});
        this.padded(side*.94,-.59,-.03,.15,.49,2.28,colors.suede,this.leather);
        this.padded(side*.87,-.35,-.06,.09,.19,1.42,colors.carbon,this.carbon);
        this.padded(side*.87,-.255,-.10,.06,.012,1.47,colors.metal,this.brushed);
        this.padded(side*.84,-.405,.05,.12,.065,.48,colors.black,this.leather);
        this.padded(side*.83,-.265,-.45,.035,.03,.20,colors.metal,this.brushed,0,0,side*.1);
        this.tube([side*1.095,-.37,-1.49],[side*.94,.70,-1.53],.042,[.22,.23,.25,1]);
        this.tube([side*1.05,-.36,-1.465],[side*.902,.69,-1.505],.013,colors.black);
        this.tube([side*.94,.70,-1.53],[side*.90,.76,.55],.027,colors.red);
        this.tube([side*.90,-.88,.64],[side*.90,.76,.64],.030,colors.red);
        this.add('cylinder',this.rodModel([side*.88,-.74,.52],[side*.93,-.29,-1.12],.024),[.36,.38,.40,1],this.brushed);
        this.tube([side*1.105,-.29,-1.48],[side*1.01,-.27,.32],.015,colors.black);
        this.padded(side*.96,.23,.22,.075,1.02,.11,colors.suede,this.alcantara);
        this.padded(side*.37,-.75,.30,.15,.32,.83,colors.black,this.alcantara,-.1);
        this.padded(side*.31,-.23,.67,.19,.85,.22,colors.black,this.alcantara,-.13,0,side*-.15);
        this.padded(side*.12,-.32,.49,.065,.77,.018,colors.red,this.leather,-.13);
        this.padded(side*.18,-.98,-1.31,.13,.023,.25,colors.metal,this.brushed,.22);
        // Vent bezel, recessed opening and individual fins.
        const vx=side*.69;
        this.add('cylinder',pose(vx,-.425,-1.02,.087,.035,.087,Math.PI/2),colors.metal,this.brushed);
        this.add('cylinder',pose(vx,-.425,-.995,.075,.012,.075,Math.PI/2),colors.black);
        for(let j=-2;j<=2;j++)this.padded(vx,-.425+j*.022,-.983,.12-Math.abs(j)*.015,.006,.011,colors.metal,this.brushed);
        // Inboard door seam and lower sill fasteners.
        for(let i=0;i<12;i++)this.tube([side*.852,-.287,-.78+i*.10],[side*.852,-.287,-.739+i*.10],.0012,[.52,.32,.29,1]);
      }
      this.tube([-.94,.70,-1.53],[.94,.70,-1.53],.025,colors.black);
      this.add('plane',pose(0,.653,-1.515,1.86,.10,1),colors.white,this.banner,0);
      // Rubber perimeter masks only the feed edges, leaving a broad windshield.
      const surround=[],panel=points=>{for(const i of [0,1,2,0,2,3])surround.push(...points[i],-1.54,0,0,1,0,0)};
      panel([[-8,-8],[-1.095,-.35],[-.94,.70],[-8,8]]);
      panel([[1.095,-.35],[8,-8],[8,8],[.94,.70]]);
      panel([[-8,8],[-.94,.70],[.94,.70],[8,8]]);
      panel([[-8,-8],[8,-8],[1.095,-.35],[-1.095,-.35]]);
      this.parts.push({mesh:this.mesh(surround),model:identity(),color:colors.black,texture:this.white,lit:1,uv:[1,1]});
      // Rear-view housing uses reflective glass only, never a fake rear feed.
      this.tube([.36,.66,-1.48],[.36,.47,-1.30],.013,colors.black);
      this.padded(.36,.465,-1.28,.30,.105,.035,colors.black,this.leather);
      this.add('plane',pose(.36,.465,-1.258,.267,.075),colors.white,this.mirror,1);
      this.padded(0,-.95,.24,.70,.15,.94,colors.black,this.alcantara);
      this.padded(0,-.40,.74,.65,1.11,.18,colors.black,this.alcantara,-.13);
      this.padded(0,.22,.75,.36,.30,.19,colors.black,this.alcantara);
      // Carbon tunnel, recessed console and machined switchgear.
      this.padded(.49,-.79,-.33,.28,.34,1.12,colors.carbon,this.carbon,.08);
      this.padded(.49,-.585,-.55,.25,.045,.35,colors.black,this.leather,.08);
      this.add('plane',pose(.49,-.55,-.51,.215,.27,1,-1.15),colors.white,this.switchTexture,0);
      for(let i=0;i<3;i++){
        const x=.419+i*.07;
        this.add('cylinder',pose(x,-.535,-.38,.019,.022,.019),colors.metal,this.brushed);
        this.add('cylinder',pose(x,-.518,-.38,.013,.012,.013),[colors.orange,colors.red,colors.white][i]);
      }
      this.tube([.49,-.72,-.10],[.49,-.51,-.13],.012,colors.metal);
      this.padded(.49,-.49,-.13,.065,.075,.058,colors.black,this.leather);
      this.padded(.49,-.70,-.12,.15,.035,.18,colors.black,this.leather);
      // Instrument binnacle with a padded hood and isolated side telemetry.
      this.padded(0,-.285,-1.01,.57,.265,.105,colors.black,this.leather,-.06);
      this.padded(0,-.155,-.985,.60,.045,.18,colors.suede,this.alcantara,-.08);
      this.padded(.495,-.39,-1.095,.32,.23,.055,colors.black,this.leather,0,-.12);
      this.tube([0,-.66,-1.20],[0,-.41,-.85],.040,colors.black);
      for(const side of [-1,1])for(const y of [-.377,-.193])this.add('cylinder',pose(side*.257,y,-.944,.004,.004,.004,Math.PI/2),colors.metal);
      // Passenger-side badge, subtle red seam and defroster slots.
      this.padded(.495,-.565,-.897,.26,.025,.007,colors.black,this.leather);
      this.add('plane',pose(.495,-.565,-.891,.24,.023),colors.white,this.banner,0);
      for(const side of [-1,1])for(let i=0;i<10;i++)this.padded(side*(.21+i*.055),-.317,-1.47,.035,.003,.063,colors.black,this.leather);
    }
    bakeCabin(){
      // Static geometry is grouped by material, keeping stereo draw calls small
      // enough for Quest 2. The steering wheel and displays remain dynamic.
      const groups=[];
      for(const p of this.parts){
        let group=groups.find(g=>g.texture===p.texture&&g.lit===p.lit&&g.color.every((v,i)=>v===p.color[i]));
        if(!group){group={texture:p.texture,lit:p.lit,color:p.color,vertices:[]};groups.push(group)}
        const m=p.model,n=normalMatrix(m),data=p.mesh.data;
        for(let i=0;i<data.length;i+=8){
          const x=data[i],y=data[i+1],z=data[i+2],nx=data[i+3],ny=data[i+4],nz=data[i+5];
          group.vertices.push(m[0]*x+m[4]*y+m[8]*z+m[12],m[1]*x+m[5]*y+m[9]*z+m[13],m[2]*x+m[6]*y+m[10]*z+m[14],
            ...normal([n[0]*nx+n[3]*ny+n[6]*nz,n[1]*nx+n[4]*ny+n[7]*nz,n[2]*nx+n[5]*ny+n[8]*nz]),data[i+6]*p.uv[0],data[i+7]*p.uv[1]);
        }
      }
      this.parts=groups.map(g=>({mesh:this.mesh(g.vertices),model:identity(),color:g.color,texture:g.texture,lit:g.lit,uv:[1,1]}));
    }
    updatePractice(state,now){
      const c=this.practiceCanvas.getContext('2d'),delta=Math.min(200,now-this.lastPractice);this.lastPractice=now;
      this.practiceDistance=(this.practiceDistance+delta*.00020*(state.armed?state.throttle:0)+1)%1;
      c.drawImage(this.skyCanvas,0,0);
      c.fillStyle='#89988a';c.beginPath();c.moveTo(0,370);for(let x=0;x<=1280;x+=20)c.lineTo(x,330+Math.sin(x/180)*15+Math.cos(x/83)*6);c.lineTo(1280,450);c.lineTo(0,450);c.fill();
      const grass=c.createLinearGradient(0,360,0,720);grass.addColorStop(0,'#7a8160');grass.addColorStop(1,'#3a4b32');c.fillStyle=grass;c.fillRect(0,360,1280,360);
      const horizon=640-state.steering*90;
      const path=(points,color)=>{c.fillStyle=color;c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.fill()};
      const road=c.createLinearGradient(0,350,0,720);road.addColorStop(0,'#6c7070');road.addColorStop(.4,'#454b4e');road.addColorStop(1,'#282d31');
      path([[horizon-52,350],[horizon+52,350],[1320,720],[-40,720]],road);
      c.save();c.beginPath();c.moveTo(horizon-52,350);c.lineTo(horizon+52,350);c.lineTo(1320,720);c.lineTo(-40,720);c.clip();c.globalAlpha=.22;c.translate(0,this.practiceDistance*200);c.fillStyle=c.createPattern(this.roadGrain,'repeat');c.fillRect(0,150,1280,720);c.restore();
      for(let i=0;i<20;i++){
        const t=((i/20+this.practiceDistance)%1)**2,next=Math.min(1,t+.025+t*.06),y=350+t*370,yn=350+next*370;
        const left=horizon-52+(-40-horizon+52)*t,right=horizon+52+(1320-horizon-52)*t,leftN=horizon-52+(-40-horizon+52)*next,rightN=horizon+52+(1320-horizon-52)*next;
        const curb=5+t*27,curbN=5+next*27,color=i%2?'#e7e9dc':'#be343c';
        path([[left-curb,y],[left,y],[leftN,yn],[leftN-curbN,yn]],color);path([[right,y],[right+curb,y],[rightN+curbN,yn],[rightN,yn]],color);
      }
      c.strokeStyle='#aebbb7';c.lineWidth=2;
      for(const side of [-1,1]){c.beginPath();c.moveTo(horizon+side*80,355);c.lineTo(640+side*890,720);c.stroke();for(let i=1;i<12;i++){const t=(i/12)**2,x=horizon+side*(80+t*810),y=355+t*365;c.beginPath();c.moveTo(x,y);c.lineTo(x,y-10-t*65);c.stroke()}}
      path([[20,250],[425,315],[425,350],[20,340]],'#667984');path([[20,245],[425,307],[407,313],[0,264]],'#d7e1df');
      c.fillStyle='#d3dee0';for(let row=0;row<4;row++)for(let i=0;i<26;i++)c.fillRect(25+i*14,267+row*15+i*1.4,6,3);
      path([[900,279],[1250,229],[1250,353],[900,350]],'#c1c7c6');c.fillStyle='#293b49';for(let i=0;i<7;i++)c.fillRect(930+i*44,295,29,25);
      c.fillStyle='#e23940';c.fillRect(905,337,360,8);c.fillStyle='#f4f0dc';c.font='bold 16px system-ui';c.fillText('ESP / CAR CIRCUIT',938,277);
      this.upload(this.practiceTexture,this.practiceCanvas);
    }
    updateHud(state,now){
      if(now-this.lastHud<100)return;this.lastHud=now;if(state.practice)this.updatePractice(state,now);
      const throttle=Math.round(Math.abs(state.throttle)*100),steering=Math.round(state.steering*100),direction=state.throttle>.02?'F':state.throttle<-.02?'R':'N';
      let c=this.dashCanvas.getContext('2d');c.textAlign='left';c.fillStyle='#080c11';c.fillRect(0,0,1024,440);
      const panel=c.createLinearGradient(0,0,0,440);panel.addColorStop(0,'#1c2631');panel.addColorStop(.55,'#0a1018');panel.addColorStop(1,'#080c11');c.fillStyle=panel;c.fillRect(0,0,1024,440);
      c.strokeStyle='#34404d';c.lineWidth=2;c.strokeRect(10,10,1004,420);
      for(let i=0;i<24;i++){c.fillStyle=i<throttle/100*24?(i<15?'#e3e8de':i<20?'#ffc267':'#f15a5c'):'#29333c';c.fillRect(32+i*40,28,30,13)}
      c.fillStyle='#acb6bf';c.font='500 23px system-ui';c.fillText('ESP / MOTORSPORT',34,88);c.textAlign='right';c.fillStyle=state.armed?'#96dbb7':'#e9b96d';c.fillText(state.armed?'ARMED':'DISARMED',986,88);
      c.strokeStyle='#35404a';c.beginPath();c.moveTo(34,110);c.lineTo(990,110);c.stroke();
      c.textAlign='center';c.fillStyle='#edf0ea';c.font='600 185px ui-monospace,monospace';c.fillText(direction,510,292);
      c.font='500 85px ui-monospace,monospace';c.fillText(String(throttle).padStart(2,'0'),192,246);c.fillText((steering>0?'+':'')+steering,832,246);
      c.fillStyle='#9ca8b3';c.font='500 21px system-ui';c.fillText('DRIVE REQUEST %',192,291);c.fillText('DIRECTION',510,330);c.fillText('STEER REQUEST %',832,291);
      c.strokeStyle='#293843';c.beginPath();c.moveTo(34,352);c.lineTo(990,352);c.stroke();
      c.textAlign='left';c.fillStyle=state.practice?'#acb6bf':state.videoFresh?'#96dbb7':'#ff7a77';c.font='500 23px system-ui';c.fillText(state.practice?'SIMULATOR  /  NO MOTORS':state.videoFresh?'FRONT CAMERA  /  LIVE':'VIDEO LOST  /  DISARMED',35,399);
      c.textAlign='right';c.fillStyle='#acb6bf';c.fillText('A  ARM     B  STOP',988,399);this.upload(this.dashTexture,this.dashCanvas);
      c=this.wheelCanvas.getContext('2d');c.textAlign='center';c.fillStyle='#091016';c.fillRect(0,0,512,256);
      c.fillStyle='#aab8be';c.font='500 21px system-ui';c.fillText('ESP / GT',256,37);c.fillStyle='#f2f1e9';c.font='500 119px ui-monospace,monospace';c.fillText(direction,256,151);
      c.fillStyle=state.armed?'#a7e1bd':'#e7bc7e';c.font='500 22px system-ui';c.fillText(state.practice?'PRACTICE':state.armed?'ARMED':'DISARMED',256,190);
      c.fillStyle='#9aa9b1';c.font='20px ui-monospace,monospace';c.fillText('DRIVE  '+String(throttle).padStart(2,'0')+'%',256,232);this.upload(this.wheelTexture,this.wheelCanvas);
      c=this.hudCanvas.getContext('2d');c.fillStyle='#071017';c.fillRect(0,0,1024,650);c.fillStyle='#ef414a';c.fillRect(0,0,8,650);c.fillStyle='#9cb2c1';c.font='bold 25px system-ui';c.fillText('DRIVER INFORMATION',35,50);
      c.fillStyle=state.armed?'#89f6c8':'#ffcd7c';c.font='bold 37px system-ui';c.fillText(state.armed?'HOLD RIGHT GRIP':'A  /  ARM AT NEUTRAL',35,112);
      c.font='27px system-ui';c.fillStyle=state.practice||state.videoFresh?'#89f6c8':'#ff7079';c.fillText(state.practice?'PRACTICE / GENERATED TRACK':state.videoFresh?'MONO FRONT CAMERA / LIVE':'CAMERA LOST / ARM BLOCKED',35,173);
      c.fillStyle='#aec0cc';c.font='26px system-ui';const words=String(state.message||'').split(' ');let line='',y=235;
      for(const word of words){if(c.measureText(line+word).width>930){c.fillText(line,35,y);line='';y+=34;if(y>350)break}line+=word+' '}c.fillText(line,35,y);
      c.strokeStyle='#273845';c.beginPath();c.moveTo(35,390);c.lineTo(989,390);c.stroke();c.font='26px system-ui';c.fillStyle='#a9bcca';c.fillText('LEFT STICK    /    STEERING',35,437);c.fillText('TRIGGERS       /    FORWARD / REVERSE',35,480);c.fillStyle='#ff777d';c.font='bold 30px system-ui';c.fillText(state.practice?'B  /  STOP PRACTICE':'B  /  EMERGENCY STOP',35,535);
      c.fillStyle='#ffcd7c';c.font='24px system-ui';if(state.practice){c.fillText('LOCAL SIMULATION / NO MOTOR SIGNALS',35,605)}else if(state.timeoutOff){c.fillText('ESP TIMEOUT OFF / LAST OUTPUT CAN PERSIST',35,588);c.fillText('Fresh video and tracked controllers required',35,624)}else{c.fillText('NO AUTO RE-ARM / RELEASE GRIP TO ZERO',35,605)}this.upload(this.hud,this.hudCanvas);
    }
    draw(vp,mesh,model,color=colors.white,texture=this.white,lit=1,uv=[1,1],flip=[1,1]){
      const g=this.gl;if(this.boundMesh!==mesh){g.bindBuffer(g.ARRAY_BUFFER,mesh.buffer);for(const [name,size,offset] of [['position',3,0],['normal',3,12],['texCoord',2,24]]){const location=this.attributes[name];g.enableVertexAttribArray(location);g.vertexAttribPointer(location,size,g.FLOAT,false,32,offset)}this.boundMesh=mesh}
      const rough=texture===this.alcantara?.95:texture===this.leather?.76:texture===this.carbon?.32:color===colors.metal?.25:.58;
      const metallic=color===colors.metal?.85:texture===this.carbon?.22:.03;
      g.uniformMatrix4fv(this.uniforms.matrix,false,multiply(vp,model));g.uniformMatrix4fv(this.uniforms.model,false,model);g.uniformMatrix3fv(this.uniforms.normals,false,normalMatrix(model));g.uniform2f(this.uniforms.surface,rough,metallic);g.uniform4fv(this.uniforms.tint,color);g.uniform2fv(this.uniforms.uvScale,uv);g.uniform2fv(this.uniforms.uvFlip,flip);g.uniform1f(this.uniforms.lit,lit);g.bindTexture(g.TEXTURE_2D,texture);g.drawArrays(g.TRIANGLES,0,mesh.count);
    }
    wheel(vp,state){
      this.lastWheelAngle=-state.steering*1.20;
      const parent=multiply(pose(0,-.41,-.80,1,1,1,-.20),rz(this.lastWheelAngle));
      if(!this.wheelParts){
      const cabin=this.parts;this.parts=[];
      const part=(mesh,m,color=colors.black,texture=this.white,lit=1)=>this.add(mesh,m,color,texture,lit,texture===this.carbon?[3,2]:texture===this.leather?[5,3]:[1,1]);
      part('rim',pose(0,0,0,.285,.277,.31),[.62,.64,.66,1],this.leather);
      for(const side of [-1,1]){
        part('rounded',pose(side*.246,-.005,.004,.075,.17,.064,0,0,side*.12),colors.suede,this.leather);
        part('rounded',pose(side*.135,-.001,-.008,.235,.068,.028,0,0,side*.10),colors.carbon,this.carbon);
        part('rounded',pose(side*.207,.018,-.058,.056,.15,.015,0,0,side*-.08),colors.metal,this.brushed);
        for(let i=0;i<3;i++)part('cylinder',pose(side*(.148+i*.027),.04-i*.022,.028,.010,.010,.010,Math.PI/2),[colors.red,colors.white,colors.orange][(i+(side>0?0:1))%3]);
        part('cylinder',pose(side*.13,-.015,.03,.016,.014,.016,Math.PI/2),colors.metal,this.brushed);
        part('cylinder',pose(side*.13,-.015,.041,.011,.007,.011,Math.PI/2),colors.black);
        // Contrasting hand stitching around the inner leather rim.
        for(let i=0;i<17;i++){
          const a=(side>0?-.66:Math.PI-.66)+i*.08;
          part('box',pose(Math.cos(a)*.249,Math.max(-.167,Math.sin(a)*.239),.022,.007,.0014,.0014,0,0,a+Math.PI/2),[.61,.40,.32,1]);
        }
      }
      part('rounded',pose(0,-.098,-.008,.066,.19,.025),colors.carbon,this.carbon);
      part('rounded',pose(0,.035,.011,.205,.138,.040),colors.black,this.leather);
      part('plane',pose(0,.037,.033,.177,.107,1),colors.white,this.wheelTexture,0);
      part('rounded',pose(0,.262,.002,.017,.037,.062),[.87,.69,.28,1]);
      for(const side of [-1,1])part('cylinder',pose(side*.068,-.044,.027,.004,.004,.004,Math.PI/2),colors.metal);
      this.bakeCabin();this.wheelParts=this.parts;this.parts=cabin;
      }
      for(const p of this.wheelParts)this.draw(vp,p.mesh,multiply(parent,p.model),p.color,p.texture,p.lit,p.uv);
    }
    scene(projection,view,state){
      const g=this.gl,vp=multiply(projection,view);g.useProgram(this.program);g.activeTexture(g.TEXTURE0);g.enable(g.DEPTH_TEST);g.disable(g.BLEND);g.disable(g.CULL_FACE);this.boundMesh=null;
      g.uniform3f(this.uniforms.eye,-(view[0]*view[12]+view[1]*view[13]+view[2]*view[14]),-(view[4]*view[12]+view[5]*view[13]+view[6]*view[14]),-(view[8]*view[12]+view[9]*view[13]+view[10]*view[14]));
      // Forward video fills the windshield behind the cabin; it is still one camera view.
      const aspect=state.practice?16/9:this.videoAspect||16/9;
      this.draw(vp,this.meshes.plane,pose(0,.28,-3.6,6.35,6.35/aspect),[1,1,1,1],state.practice?this.practiceTexture:state.videoFresh?this.video:this.blank,0,[1,1],!state.practice&&state.videoFresh?this.videoFlip:[1,1]);
      for(const p of this.parts)this.draw(vp,p.mesh,p.model,p.color,p.texture,p.lit,p.uv);
      this.draw(vp,this.meshes.plane,pose(0,-.285,-.951,.51,.213,1,-.06),colors.white,this.dashTexture,0);
      this.draw(vp,this.meshes.plane,pose(.495,-.39,-1.063,.287,.19,1,0,-.12),colors.white,this.hud,0);
      this.wheel(vp,state);
    }
    preview(state,now){
      const g=this.gl;if(g.isContextLost())return;this.updateHud(state,now);
      const width=Math.round(this.canvas.clientWidth*Math.min(devicePixelRatio,1.5)),height=Math.round(this.canvas.clientHeight*Math.min(devicePixelRatio,1.5));
      if(this.canvas.width!==width||this.canvas.height!==height){this.canvas.width=width;this.canvas.height=height}
      g.bindFramebuffer(g.FRAMEBUFFER,null);g.viewport(0,0,width,height);g.clearColor(.045,.068,.085,1);g.clear(g.COLOR_BUFFER_BIT|g.DEPTH_BUFFER_BIT);
      const f=1/Math.tan(62*Math.PI/360),aspect=width/height,near=.035,far=100;
      this.scene(new Float32Array([f/aspect,0,0,0,0,f,0,0,0,0,(far+near)/(near-far),-1,0,0,2*far*near/(near-far),0]),multiply(rx(.10),translate(0,-.015,-.06)),state);
    }
    xr(frame,space,layer,state,now){
      const g=this.gl,pose=frame.getViewerPose(space);if(!pose)return false;
      this.updateHud(state,now);g.bindFramebuffer(g.FRAMEBUFFER,layer.framebuffer);g.clearColor(.045,.068,.085,1);g.clear(g.COLOR_BUFFER_BIT|g.DEPTH_BUFFER_BIT);
      for(const view of pose.views){const viewport=layer.getViewport(view);g.viewport(viewport.x,viewport.y,viewport.width,viewport.height);this.scene(view.projectionMatrix,view.transform.inverse.matrix,state)}return true;
    }
  }
  root.RCQuestRenderer={CockpitRenderer};
})(globalThis);
