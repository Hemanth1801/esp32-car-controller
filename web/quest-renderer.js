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
  const colors={carbon:[.58,.62,.67,1],black:[.035,.045,.055,1],rubber:[.025,.03,.035,1],metal:[.32,.36,.39,1],red:[.65,.035,.045,1],orange:[.95,.21,.055,1],white:[.82,.86,.87,1],green:[.16,.85,.6,1]};
  function plane(){return [-.5,-.5,0,0,0,1,0,0,.5,-.5,0,0,0,1,1,0,-.5,.5,0,0,0,1,0,1,-.5,.5,0,0,0,1,0,1,.5,-.5,0,0,0,1,1,0,.5,.5,0,0,0,1,1,1]}
  function box(){
    const out=[],faces=[[[0,0,1],[-1,-1,1],[1,-1,1],[-1,1,1],[1,1,1]],[[0,0,-1],[1,-1,-1],[-1,-1,-1],[1,1,-1],[-1,1,-1]],[[1,0,0],[1,-1,1],[1,-1,-1],[1,1,1],[1,1,-1]],[[-1,0,0],[-1,-1,-1],[-1,-1,1],[-1,1,-1],[-1,1,1]],[[0,1,0],[-1,1,1],[1,1,1],[-1,1,-1],[1,1,-1]],[[0,-1,0],[-1,-1,-1],[1,-1,-1],[-1,-1,1],[1,-1,1]]];
    for(const [n,a,b,c,d] of faces)for(const [p,uv] of [[a,[0,0]],[b,[1,0]],[c,[0,1]],[c,[0,1]],[b,[1,0]],[d,[1,1]]])out.push(...p.map(v=>v*.5),...n,...uv);return out;
  }
  function cylinder(segments=12){
    const out=[],point=(a,y)=>[Math.cos(a),y,Math.sin(a)],v=(p,n,uv)=>out.push(...p,...n,...uv);
    for(let i=0;i<segments;i++){
      const a=i/segments*Math.PI*2,b=(i+1)/segments*Math.PI*2,na=[Math.cos(a),0,Math.sin(a)],nb=[Math.cos(b),0,Math.sin(b)];
      for(const [p,n,u] of [[point(a,-.5),na,0],[point(b,-.5),nb,1],[point(a,.5),na,0],[point(a,.5),na,0],[point(b,-.5),nb,1],[point(b,.5),nb,1]])v(p,n,[u,p[1]+.5]);
      for(const y of [-.5,.5])for(const p of [[0,y,0],point(a,y),point(b,y)])v(p,[0,Math.sign(y),0],[(p[0]+1)/2,(p[2]+1)/2]);
    }return out;
  }
  function wheelRim(){
    const out=[],around=64,tube=8;
    const vertex=(i,j)=>{const a=i/around*Math.PI*2,b=j/tube*Math.PI*2,c=Math.cos(a),s=Math.sin(a),flat=s<-.66,px=c*.92,py=Math.max(-.61,s*.92),nx=flat?0:c,ny=flat?-1:s,n=[nx*Math.cos(b),ny*Math.cos(b),Math.sin(b)];return [px+nx*Math.cos(b)*.105,py+ny*Math.cos(b)*.105,Math.sin(b)*.105,...n,i/around,j/tube]};
    for(let i=0;i<around;i++)for(let j=0;j<tube;j++)for(const [a,b] of [[i,j],[i+1,j],[i,j+1],[i,j+1],[i+1,j],[i+1,j+1]])out.push(...vertex(a,b));return out;
  }
  class CockpitRenderer{
    constructor(canvas){
      this.canvas=canvas;const g=this.gl=canvas.getContext('webgl',{antialias:true,alpha:false,xrCompatible:true});
      if(!g)throw Error('WebGL is unavailable. Enable hardware acceleration to preview the cockpit.');
      const shader=(type,source)=>{const s=g.createShader(type);g.shaderSource(s,source);g.compileShader(s);if(!g.getShaderParameter(s,g.COMPILE_STATUS))throw Error('Cockpit shader failed');return s};
      this.program=g.createProgram();
      g.attachShader(this.program,shader(g.VERTEX_SHADER,'attribute vec3 position; attribute vec3 normal; attribute vec2 texCoord; uniform mat4 matrix; uniform mat4 model; uniform vec2 uvScale; varying vec2 uv; varying vec3 faceNormal; void main(){uv=texCoord*uvScale;faceNormal=normalize(mat3(model)*normal);gl_Position=matrix*vec4(position,1.0);}'));
      g.attachShader(this.program,shader(g.FRAGMENT_SHADER,'precision mediump float; varying vec2 uv; varying vec3 faceNormal; uniform sampler2D image; uniform vec4 tint; uniform float lit; void main(){vec3 n=normalize(faceNormal);float light=0.35+0.5*max(dot(n,normalize(vec3(-0.4,0.9,0.6))),0.0)+0.18*max(dot(n,normalize(vec3(1.0,0.1,0.4))),0.0);vec4 color=texture2D(image,uv)*tint;gl_FragColor=vec4(color.rgb*mix(1.0,light,lit),color.a);}'));
      g.linkProgram(this.program);if(!g.getProgramParameter(this.program,g.LINK_STATUS))throw Error('Cockpit shader link failed');
      this.attributes=Object.fromEntries(['position','normal','texCoord'].map(name=>[name,g.getAttribLocation(this.program,name)]));
      this.uniforms=Object.fromEntries(['matrix','model','uvScale','tint','lit'].map(name=>[name,g.getUniformLocation(this.program,name)]));
      this.meshes={plane:this.mesh(plane()),box:this.mesh(box()),cylinder:this.mesh(cylinder()),rim:this.mesh(wheelRim())};
      this.white=this.texture();g.texImage2D(g.TEXTURE_2D,0,g.RGBA,1,1,0,g.RGBA,g.UNSIGNED_BYTE,new Uint8Array([255,255,255,255]));
      for(const name of ['video','hud','blank','practiceTexture','dashTexture','wheelTexture','carbon','banner','switchTexture'])this[name]=this.texture();
      this.practiceCanvas=this.canvas2d(1280,720);this.hudCanvas=this.canvas2d(1024,650);this.dashCanvas=this.canvas2d(1024,440);this.wheelCanvas=this.canvas2d(512,256);
      this.practiceDistance=0;this.lastPractice=0;this.lastHud=-Infinity;this.lastWheelAngle=0;
      this.makeMaterials();this.parts=[];this.makeCabin();
      canvas.addEventListener('webglcontextlost',event=>{event.preventDefault();canvas.dispatchEvent(new Event('cockpitlost'))});
    }
    canvas2d(w,h){const c=document.createElement('canvas');c.width=w;c.height=h;return c}
    mesh(vertices){const g=this.gl,buffer=g.createBuffer();g.bindBuffer(g.ARRAY_BUFFER,buffer);g.bufferData(g.ARRAY_BUFFER,new Float32Array(vertices),g.STATIC_DRAW);return {buffer,count:vertices.length/8}}
    texture(){const g=this.gl,t=g.createTexture();g.bindTexture(g.TEXTURE_2D,t);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MIN_FILTER,g.LINEAR);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_MAG_FILTER,g.LINEAR);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_S,g.CLAMP_TO_EDGE);g.texParameteri(g.TEXTURE_2D,g.TEXTURE_WRAP_T,g.CLAMP_TO_EDGE);return t}
    upload(texture,source){const g=this.gl;g.bindTexture(g.TEXTURE_2D,texture);g.pixelStorei(g.UNPACK_FLIP_Y_WEBGL,true);g.texImage2D(g.TEXTURE_2D,0,g.RGBA,g.RGBA,g.UNSIGNED_BYTE,source)}
    updateVideo(bitmap){this.videoAspect=bitmap.width/bitmap.height;this.upload(this.video,bitmap)}
    makeMaterials(){
      let c=this.canvas2d(128,128),x=c.getContext('2d');x.fillStyle='#31343a';x.fillRect(0,0,128,128);
      for(let y=0;y<128;y+=8)for(let a=0;a<128;a+=8){const flip=((a+y)/8)%2;x.fillStyle=flip?'#24272c':'#3c4047';x.fillRect(a,y,8,8);x.fillStyle=flip?'#33373d':'#474b52';for(let k=1;k<8;k+=3)x.fillRect(a+(flip?k:0),y+(flip?0:k),flip?1:8,flip?8:1)}
      this.upload(this.carbon,c);this.gl.texParameteri(this.gl.TEXTURE_2D,this.gl.TEXTURE_WRAP_S,this.gl.REPEAT);this.gl.texParameteri(this.gl.TEXTURE_2D,this.gl.TEXTURE_WRAP_T,this.gl.REPEAT);
      c=this.canvas2d(1024,100);x=c.getContext('2d');x.fillStyle='#101318';x.fillRect(0,0,1024,100);x.fillStyle='#ee3b41';x.fillRect(0,84,1024,10);x.fillStyle='#f2f4ef';x.textAlign='center';x.font='italic 800 56px system-ui';x.fillText('ESP / CAR     RACING',512,65);this.upload(this.banner,c);
      c=this.canvas2d(960,540);x=c.getContext('2d');x.fillStyle='#18202b';x.fillRect(0,0,960,540);x.fillStyle='#ff777d';x.textAlign='center';x.font='bold 36px system-ui';x.fillText('CAMERA SIGNAL LOST',480,260);x.fillStyle='#c2cbd4';x.font='24px system-ui';x.fillText('Live car stays disarmed until video returns',480,306);this.upload(this.blank,c);
      c=this.canvas2d(512,256);x=c.getContext('2d');x.fillStyle='#11161b';x.fillRect(0,0,512,256);x.fillStyle='#c8ced4';x.font='bold 22px system-ui';x.fillText('TOUCH CONTROLLER',26,44);x.font='21px system-ui';x.fillText('A  ARM / DISARM',26,100);x.fillStyle='#f66b72';x.fillText('B  EMERGENCY STOP',26,146);x.fillStyle='#9bdbcb';x.fillText('HOLD RIGHT GRIP TO DRIVE',26,210);this.upload(this.switchTexture,c);
    }
    add(mesh,model,color=colors.black,texture=this.white,lit=1,uv=[1,1]){this.parts.push({mesh:this.meshes[mesh],model,color,texture,lit,uv})}
    solid(x,y,z,w,h,d,color=colors.black,texture=this.white,ax=0,ay=0,az=0){this.add('box',pose(x,y,z,w,h,d,ax,ay,az),color,texture,1,texture===this.carbon?[7,4]:[1,1])}
    rodModel(a,b,r){const y=normal(b.map((v,i)=>v-a[i])),x=normal(cross(y,Math.abs(y[1])>.9?[1,0,0]:[0,1,0])),z=cross(x,y),length=Math.hypot(...b.map((v,i)=>v-a[i]));return new Float32Array([x[0]*r,x[1]*r,x[2]*r,0,y[0]*length,y[1]*length,y[2]*length,0,z[0]*r,z[1]*r,z[2]*r,0,...a.map((v,i)=>(v+b[i])/2),1])}
    tube(a,b,r,color=colors.red){this.add('cylinder',this.rodModel(a,b,r),color)}
    makeCabin(){
      // Eye origin is the driver's seated head position; all dimensions are metres.
      this.solid(0,-1.02,-.35,1.8,.12,3.6,colors.carbon,this.carbon);
      this.solid(0,.91,-.5,1.87,.10,3.3,colors.carbon,this.carbon);
      this.solid(0,-.46,-1.51,1.75,.29,.55,colors.carbon,this.carbon,.10);
      this.solid(0,-.31,-1.64,1.72,.06,.54,colors.black,this.carbon,.12);
      this.solid(0,-.62,-1.53,1.7,.13,.36,colors.black);
      this.solid(0,-.42,-2.02,1.72,.08,.42,colors.black,this.carbon,.13);
      for(const side of [-1,1]){
        this.solid(side*.85,-.65,-.30,.16,.35,2.75,colors.carbon,this.carbon);
        this.solid(side*.92,-.22,-.12,.11,.63,1.95,colors.black,this.carbon);
        this.solid(side*.86,-.12,-.15,.04,.035,1.62,colors.red);
        this.solid(side*.78,-.43,-.10,.16,.07,.62,colors.black);
        this.tube([side*1.0,-.40,-1.48],[side*.96,.72,-1.80],.048,colors.black);
        this.tube([side*.94,-.38,-1.44],[side*.91,.74,-1.80],.022,colors.red);
        this.tube([side*.91,.74,-1.80],[side*.83,.82,.72],.029,colors.red);
        this.tube([side*.83,-.85,.72],[side*.83,.82,.72],.032,colors.red);
        this.tube([side*.83,-.75,.55],[side*.87,-.05,-1.2],.026,colors.metal);
        this.solid(side*.89,.50,.65,.055,.75,.10,colors.black);
        this.solid(side*.30,-.73,.30,.15,.35,.78,colors.black,this.carbon,-.1);
        this.solid(side*.32,-.26,.68,.16,.78,.20,colors.black,this.carbon,-.12,0,side*-.14);
        this.solid(side*.12,-.37,.56,.065,.72,.022,colors.red,this.white,-.12);
        this.solid(side*.22,-.96,-1.60,.14,.035,.27,colors.metal,this.white,.22);
      }
      this.tube([-.91,.74,-1.80],[.91,.74,-1.80],.032,colors.red);
      this.add('plane',pose(0,.66,-1.78,1.88,.14,1),colors.white,this.banner,0);
      // Bodywork masks the rectangular feed edges to form the windshield opening.
      const surround=[],panel=points=>{for(const i of [0,1,2,0,2,3])surround.push(...points[i],-1.77,0,0,1,0,0)};
      panel([[-8,-8],[-1.17,-.48],[-.94,.74],[-8,8]]);
      panel([[1.17,-.48],[8,-8],[8,8],[.94,.74]]);
      panel([[-8,8],[-.94,.74],[.94,.74],[8,8]]);
      panel([[-8,-8],[8,-8],[1.17,-.48],[-1.17,-.48]]);
      this.parts.push({mesh:this.mesh(surround),model:translate(0,0,0),color:colors.black,texture:this.white,lit:0,uv:[1,1]});
      this.solid(0,-.94,.23,.63,.12,.9,colors.black,this.carbon);
      this.solid(0,-.42,.74,.60,1.02,.13,colors.black,this.carbon,-.12);
      this.solid(0,.15,.76,.34,.25,.16,colors.black);
      this.solid(.59,-.77,-.39,.25,.40,1.12,colors.carbon,this.carbon,.12);
      this.add('plane',pose(.59,-.53,-.38,.21,.40,1,-1.2),colors.white,this.switchTexture,0);
      for(let i=0;i<4;i++)this.tube([.53+(i%2)*.12,-.52,-.17-Math.floor(i/2)*.12],[.53+(i%2)*.12,-.48,-.17-Math.floor(i/2)*.12],.018,[colors.red,colors.orange,colors.white,colors.green][i]);
      this.solid(0,-.26,-1.24,.63,.28,.09,colors.black);
      this.solid(.59,-.30,-1.24,.57,.40,.07,colors.black,this.carbon,0,-.16);
      this.tube([0,-.58,-1.25],[0,-.48,-.84],.055,colors.black);
      this.solid(0,-.46,-.95,.20,.15,.13,colors.black);
      for(const side of [-1,1])for(const y of [-.37,-.15])this.tube([side*.29,y,-1.19],[side*.29,y,-1.18],.008,colors.metal);
      this.add('box',pose(0,-.59,-1.20,1.6,.012,.012),[.9,.03,.035,1],this.white,0);
    }
    updatePractice(state,now){
      const c=this.practiceCanvas.getContext('2d'),delta=Math.min(200,now-this.lastPractice);this.lastPractice=now;
      this.practiceDistance=(this.practiceDistance+delta*.00020*(state.armed?state.throttle:0)+1)%1;
      const sky=c.createLinearGradient(0,0,0,390);sky.addColorStop(0,'#2c658a');sky.addColorStop(1,'#bdd9dc');c.fillStyle=sky;c.fillRect(0,0,1280,720);
      c.fillStyle='#e6edef';for(const [x,y,w] of [[160,100,160],[870,70,220],[560,145,110]]){c.beginPath();c.ellipse(x,y,w,15,0,0,Math.PI*2);c.fill()}
      c.fillStyle='#6c9380';c.beginPath();c.moveTo(0,370);for(let x=0;x<=1280;x+=20)c.lineTo(x,320+Math.sin(x/120)*20+Math.cos(x/65)*8);c.lineTo(1280,450);c.lineTo(0,450);c.fill();
      c.fillStyle='#56814a';c.fillRect(0,360,1280,360);
      const horizon=640-state.steering*90;
      const path=(points,color)=>{c.fillStyle=color;c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.fill()};
      path([[horizon-52,350],[horizon+52,350],[1320,720],[-40,720]],'#343b41');
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
      let c=this.dashCanvas.getContext('2d');c.fillStyle='#03090d';c.fillRect(0,0,1024,440);
      for(let i=0;i<16;i++){c.fillStyle=i<throttle/100*16?(i<10?'#76f0c1':i<13?'#ffd659':'#f34b50'):'#17242c';c.fillRect(36+i*60,20,45,17)}
      c.fillStyle=state.armed?'#89f6c8':'#ffcd7c';c.font='bold 38px system-ui';c.fillText(state.practice?'PRACTICE / SIM':'LIVE / CAR',40,98);c.font='bold 29px system-ui';c.fillText(state.armed?'ARMED':'DISARMED',730,98);
      c.fillStyle='#edf6fa';c.font='bold 180px system-ui';c.textAlign='center';c.fillText(direction,512,288);c.font='bold 80px ui-monospace, monospace';c.fillText(String(throttle).padStart(2,'0')+'%',185,252);c.fillText((steering>0?'+':'')+steering+'%',838,252);
      c.fillStyle='#8aa1ae';c.font='25px system-ui';c.fillText('DRIVE REQUEST',185,302);c.fillText('DIRECTION',512,332);c.fillText('STEER REQUEST',838,302);c.textAlign='left';
      c.fillStyle=state.practice?'#8aa1ae':state.videoFresh?'#89f6c8':'#ff6f76';c.font='bold 25px system-ui';c.fillText(state.practice?'NO MOTOR COMMANDS':state.videoFresh?'CAMERA LIVE':'VIDEO LOST / DISARMED',40,395);c.fillStyle='#9bb0be';c.fillText('A  ARM     B  STOP',694,395);this.upload(this.dashTexture,this.dashCanvas);
      c=this.wheelCanvas.getContext('2d');c.fillStyle='#08111a';c.fillRect(0,0,512,256);c.textAlign='center';c.fillStyle='#83e9c5';c.font='bold 25px system-ui';c.fillText('ESP / CAR',256,37);c.fillStyle='#f1f6fa';c.font='bold 115px ui-monospace, monospace';c.fillText(direction,256,151);c.font='bold 28px system-ui';c.fillStyle='#e7b85f';c.fillText(state.practice?'PRACTICE':'LIVE CAR',256,191);c.fillStyle='#a4b7c6';c.font='22px system-ui';c.fillText('REQUESTED POWER '+throttle+'%',256,234);this.upload(this.wheelTexture,this.wheelCanvas);
      c=this.hudCanvas.getContext('2d');c.fillStyle='#071017';c.fillRect(0,0,1024,650);c.fillStyle='#ef414a';c.fillRect(0,0,8,650);c.fillStyle='#9cb2c1';c.font='bold 25px system-ui';c.fillText('DRIVER INFORMATION',35,50);
      c.fillStyle=state.armed?'#89f6c8':'#ffcd7c';c.font='bold 37px system-ui';c.fillText(state.armed?'HOLD RIGHT GRIP':'A  /  ARM AT NEUTRAL',35,112);
      c.font='27px system-ui';c.fillStyle=state.practice||state.videoFresh?'#89f6c8':'#ff7079';c.fillText(state.practice?'PRACTICE / GENERATED TRACK':state.videoFresh?'MONO FRONT CAMERA / LIVE':'CAMERA LOST / ARM BLOCKED',35,173);
      c.fillStyle='#aec0cc';c.font='26px system-ui';const words=String(state.message||'').split(' ');let line='',y=235;
      for(const word of words){if(c.measureText(line+word).width>930){c.fillText(line,35,y);line='';y+=34;if(y>350)break}line+=word+' '}c.fillText(line,35,y);
      c.strokeStyle='#273845';c.beginPath();c.moveTo(35,390);c.lineTo(989,390);c.stroke();c.font='26px system-ui';c.fillStyle='#a9bcca';c.fillText('LEFT STICK    /    STEERING',35,437);c.fillText('TRIGGERS       /    FORWARD / REVERSE',35,480);c.fillStyle='#ff777d';c.font='bold 30px system-ui';c.fillText(state.practice?'B  /  STOP PRACTICE':'B  /  EMERGENCY STOP',35,535);
      c.fillStyle='#ffcd7c';c.font='24px system-ui';if(state.practice){c.fillText('LOCAL SIMULATION / NO MOTOR SIGNALS',35,605)}else if(state.timeoutOff){c.fillText('ESP TIMEOUT OFF / LAST OUTPUT CAN PERSIST',35,588);c.fillText('Fresh video and tracked controllers required',35,624)}else{c.fillText('NO AUTO RE-ARM / RELEASE GRIP TO ZERO',35,605)}this.upload(this.hud,this.hudCanvas);
    }
    draw(vp,mesh,model,color=colors.white,texture=this.white,lit=1,uv=[1,1]){
      const g=this.gl;if(this.boundMesh!==mesh){g.bindBuffer(g.ARRAY_BUFFER,mesh.buffer);for(const [name,size,offset] of [['position',3,0],['normal',3,12],['texCoord',2,24]]){const location=this.attributes[name];g.enableVertexAttribArray(location);g.vertexAttribPointer(location,size,g.FLOAT,false,32,offset)}this.boundMesh=mesh}
      g.uniformMatrix4fv(this.uniforms.matrix,false,multiply(vp,model));g.uniformMatrix4fv(this.uniforms.model,false,model);g.uniform4fv(this.uniforms.tint,color);g.uniform2fv(this.uniforms.uvScale,uv);g.uniform1f(this.uniforms.lit,lit);g.bindTexture(g.TEXTURE_2D,texture);g.drawArrays(g.TRIANGLES,0,mesh.count);
    }
    wheel(vp,state){
      this.lastWheelAngle=-state.steering*1.20;
      const parent=multiply(pose(0,-.48,-.82,1,1,1,-.16),rz(this.lastWheelAngle));
      const part=(mesh,m,color=colors.black,texture=this.white,lit=1)=>this.draw(vp,this.meshes[mesh],multiply(parent,m),color,texture,lit,texture===this.carbon?[3,2]:[1,1]);
      part('rim',pose(0,0,0,.28,.25,.28),colors.rubber);
      part('box',pose(-.215,0,-.012,.065,.18,.045,0,0,-.12),colors.rubber);part('box',pose(.215,0,-.012,.065,.18,.045,0,0,.12),colors.rubber);
      part('box',pose(0,-.06,-.008,.085,.20,.025),colors.carbon,this.carbon);
      for(const side of [-1,1]){part('box',pose(side*.13,.008,-.008,.22,.065,.03,0,0,side*.12),colors.carbon,this.carbon);part('box',pose(side*.19,.018,-.055,.045,.15,.018),colors.metal);part('cylinder',pose(side*.16,.045,.029,.017,.018,.017,Math.PI/2),side>0?colors.red:colors.orange)}
      part('box',pose(0,.045,.012,.23,.135,.035),colors.black);
      part('plane',pose(0,.045,.031,.21,.115,1),colors.white,this.wheelTexture,0);
      part('box',pose(0,.233,.002,.019,.032,.055),[1,.75,.1,1]);
    }
    scene(projection,view,state){
      const g=this.gl,vp=multiply(projection,view);g.useProgram(this.program);g.activeTexture(g.TEXTURE0);g.enable(g.DEPTH_TEST);g.disable(g.BLEND);g.disable(g.CULL_FACE);this.boundMesh=null;
      // Forward video fills the windshield behind the cabin; it is still one camera view.
      const aspect=state.practice?16/9:this.videoAspect||16/9,available=state.practice||state.videoFresh;
      this.draw(vp,this.meshes.plane,pose(0,.24,-3.6,available?Math.min(5.6,3.15*aspect):5.6,available?Math.min(3.15,5.6/aspect):3.15),colors.white,state.practice?this.practiceTexture:state.videoFresh?this.video:this.blank,0);
      for(const p of this.parts)this.draw(vp,p.mesh,p.model,p.color,p.texture,p.lit,p.uv);
      this.draw(vp,this.meshes.plane,pose(0,-.26,-1.189,.59,.245,1),colors.white,this.dashTexture,0);
      this.draw(vp,this.meshes.plane,pose(.59,-.30,-1.194,.535,.365,1,0,-.16),colors.white,this.hud,0);
      this.wheel(vp,state);
    }
    preview(state,now){
      const g=this.gl;if(g.isContextLost())return;this.updateHud(state,now);
      const width=Math.round(this.canvas.clientWidth*Math.min(devicePixelRatio,1.5)),height=Math.round(this.canvas.clientHeight*Math.min(devicePixelRatio,1.5));
      if(this.canvas.width!==width||this.canvas.height!==height){this.canvas.width=width;this.canvas.height=height}
      g.bindFramebuffer(g.FRAMEBUFFER,null);g.viewport(0,0,width,height);g.clearColor(.045,.068,.085,1);g.clear(g.COLOR_BUFFER_BIT|g.DEPTH_BUFFER_BIT);
      const f=1/Math.tan(75*Math.PI/360),aspect=width/height,near=.035,far=100;
      this.scene(new Float32Array([f/aspect,0,0,0,0,f,0,0,0,0,(far+near)/(near-far),-1,0,0,2*far*near/(near-far),0]),multiply(rx(.09),translate(0,-.025,-.10)),state);
    }
    xr(frame,space,layer,state,now){
      const g=this.gl,pose=frame.getViewerPose(space);if(!pose)return false;
      this.updateHud(state,now);g.bindFramebuffer(g.FRAMEBUFFER,layer.framebuffer);g.clearColor(.045,.068,.085,1);g.clear(g.COLOR_BUFFER_BIT|g.DEPTH_BUFFER_BIT);
      for(const view of pose.views){const viewport=layer.getViewport(view);g.viewport(viewport.x,viewport.y,viewport.width,viewport.height);this.scene(view.projectionMatrix,view.transform.inverse.matrix,state)}return true;
    }
  }
  root.RCQuestRenderer={CockpitRenderer};
})(globalThis);
