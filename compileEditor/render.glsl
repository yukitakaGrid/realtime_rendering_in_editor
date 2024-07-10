precision highp float;
uniform vec2 resolution;
uniform vec2 mouse;
uniform int frame;
uniform float time;
uniform sampler2D backbuffer;

#define DIST_MIN 0.00001
#define ITE_MAX 90
#define DIST_COEFF 1.

vec3 repetition(vec3 p,float fre){
    return mod(p,fre)-fre*0.5;
}

float sdSphere( vec3 p, float s , float f)
{
    p = repetition(p,f);
    return length(p)-s;
}

float map(vec3 p){
    float size = 0.5;
    float fre = 2.;
    return sdSphere(p+vec3(0.,0.,0.),size,fre);
}

float raymarch(vec3 camera, vec3 ray){
    float stepDist = 0.;
    for(int i=0;i<ITE_MAX;i++){
        vec3 pos = camera+ray*stepDist;

        float d = map(pos);

        if(d<DIST_MIN){
            break;
        }
        stepDist+=d*DIST_COEFF;
    }

    return stepDist;
}

vec3 rotate ( vec3 pos, vec3 axis,float theta )
{
    axis = normalize( axis );

    vec3 v = cross( pos, axis );
    vec3 u = cross( axis, v );

    return u * cos( theta ) + v * sin( theta ) + axis * dot( pos, axis );
}

void main()
{
    vec2 uv = (gl_FragCoord.xy*2.-resolution.xy)/min(resolution.x,resolution.y);
    vec3 col = vec3(0.);

    vec3 camera = vec3(0.,0.,time*0.5);
    vec3 ray = normalize(vec3(uv,1.0));
    ray = rotate(ray,vec3(0.,1.,0.),sin(time*0.1)*0.1);

    float dist = raymarch(camera,ray);

    gl_FragColor = vec4(vec3(dist*0.1),1.);
}