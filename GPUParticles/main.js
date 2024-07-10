import {getViewMatrix,getPerspectiveMatrix} from './matrix.js';

let color = [1,1,0];
let numParticles = 1000;
let particlesData;
let particlesStorage;

let device;
let canvasFormat;
let shaderModule;
let simulationShaderModule;
let bindGroupLayout;
let pipelineLayout;
let bindGroup;
let pipeline;
let simulationPipeline;

let viewMatrixBuffer;
let projMatrixBuffer;
let uniformBuffer;
let timeBuffer;
let deltaTimeBuffer;

let time = 0;
let step = 0;

const WORKGROUP_SIZE = 8;

async function main(){
    const updateInterval = 100; 
    const particleSize = { x: 0.1, y: 0.1 }; 

    const canvas = document.querySelector("canvas");
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    let lastTime = performance.now();

    try{
        if (!navigator.gpu) {
            throw new Error("WebGPU not supported on this browser.");
        }
        
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
            throw new Error("No appropriate GPUAdapter found.");
        }
        device = await adapter.requestDevice();
    
        if (!device) {
            console.error("Failed to get GPU device!");
            return;
        }
    
        console.log("Device initialized successfully");
    } catch (error) {
        console.error("Error initializing WebGPU:", error);
    }
    
    const context = canvas.getContext("webgpu");
    canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
        device: device,
        format: canvasFormat,
    });

    // Camera settings
    const cameraPosition = { x: 0, y: 0, z: -1 };
    const cameraLookAt = { x: 0, y: 0, z: 0 };
    const cameraUp = { x: 0, y: 1, z: 0 };
    const fov = 60 * Math.PI / 180; // in radians
    const aspectRatio = canvas.width / canvas.height;
    const near = 0.1;
    const far = 100;

    const viewMatrix = getViewMatrix(cameraPosition, cameraLookAt, cameraUp);
    const projectionMatrix = getPerspectiveMatrix(fov, aspectRatio, near, far);

    // View matrix buffer
    viewMatrixBuffer = device.createBuffer({
        size: 64, // 4x4 matrix of float32
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true
    });
    new Float32Array(viewMatrixBuffer.getMappedRange()).set(viewMatrix);
    viewMatrixBuffer.unmap();

    // Projection matrix buffer
    projMatrixBuffer = device.createBuffer({
        size: 64, // 4x4 matrix of float32
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true
    });
    new Float32Array(projMatrixBuffer.getMappedRange()).set(projectionMatrix);
    projMatrixBuffer.unmap();

    // パーティクルのデータ初期化
    particlesData = new Float32Array(numParticles * 4); // x, y, vx, vy
    for (let i = 0; i < numParticles; i++) {
        particlesData[i * 4 + 0] = Math.random() * 2 - 1; // x
        particlesData[i * 4 + 1] = Math.random() * 2 - 1; // y
        particlesData[i * 4 + 2] = Math.random() * 0; // vx
        particlesData[i * 4 + 3] = Math.random() * 0; // vy
    }
    
    particlesStorage = [
        device.createBuffer({
          label: "Particles A",
          size: particlesData.byteLength,
          usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
          mappedAtCreation: true,
        }),
        device.createBuffer({
          label: "Particles B",
           size: particlesData.byteLength,
           usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
           mappedAtCreation: true,
        })
      ];
    new Float32Array(particlesStorage[0].getMappedRange()).set(particlesData);
    particlesStorage[0].unmap();
    new Float32Array(particlesStorage[1].getMappedRange()).set(particlesData);
    particlesStorage[1].unmap();

    const uniformBufferSize = 4 * 4; //本来はvec3で4バイト×3で12バイトのはずだが、なぜか16バイト要求される。webgpuの仕様？
    uniformBuffer = device.createBuffer({
        size: uniformBufferSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
    });
    new Float32Array(uniformBuffer.getMappedRange()).set(color);
    uniformBuffer.unmap();

    time = Date.now();
    const timeBufferSize = 4;
    timeBuffer = device.createBuffer({
        size: timeBufferSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
    })
    new Float32Array(timeBuffer.getMappedRange()).set(time)
    timeBuffer.unmap();

    const deltaTimeBufferSize = 4;
    deltaTimeBuffer = device.createBuffer({
        size: deltaTimeBufferSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
    })
    deltaTimeBuffer.unmap();

    // シェーダーモジュールの定義
    shaderModule = device.createShaderModule({
        code: `
            struct Uniforms {
                color : vec3<f32>,
            };

            @group(0) @binding(0)
            var<uniform> viewMatrix: mat4x4<f32>;

            @group(0) @binding(1)
            var<uniform> projMatrix: mat4x4<f32>;

            @group(0) @binding(2)
            var<storage, read> particles : array<vec4<f32>>;  // 更新は削除し、読み取りのみを行う

            @group(0) @binding(4) var<uniform> uniforms : Uniforms;

            @vertex
            fn vertexMain(@builtin(vertex_index) index : u32) -> @builtin(position) vec4<f32> {
                let particle = particles[index];
                let position = particle.xy;
                return vec4<f32>(position, 0.0, 1.0);  // GPU上でのデータ更新は削除
            }

            @fragment
            fn fragmentMain() -> @location(0) vec4<f32> {
                return vec4<f32>(uniforms.color, 1.0);  // 描画色の指定
            }

        `,
    });

    simulationShaderModule = device.createShaderModule({
        label: "Particles simulation shader",
        code: `
            @group(0) @binding(2)
            var<storage,read> particles : array<vec4<f32>>;

            @group(0) @binding(3)
            var<storage,read_write> particles_w : array<vec4<f32>>;

            @group(0) @binding(5) var<uniform> time : f32;

            @group(0) @binding(6) var<uniform> deltaTime : f32;

            @compute @workgroup_size(${WORKGROUP_SIZE})
            fn computeMain(@builtin(global_invocation_id) cell: vec3u) {
                let index = cell.x;
                var x = particles[index].x;
                var y = particles[index].y;
                var vx = particles[index].z;
                var vy = particles[index].w;

                let lateTime = time;

                var fx = 0.0;
                var fy = 0.0;
                fx += sin(lateTime + f32(cell.x)) * 0.5; //x軸の力場
                fy += cos(lateTime + f32(cell.x)) * 0.5; //y軸の力場

                vx += fx * deltaTime;
                vy += fy * deltaTime;

                x += vx * deltaTime;
                y += vy * deltaTime;

                //範囲の数値はカメラのパラメーターによって手動で調整、自動で算出できたら嬉しい
                if (x < -1) {
                    x = 0.32;
                }
                if(x > 0.32){
                    x = -1;
                }
                if (y < -0.8) {
                    y = 1;
                }
                if(y >= 1){
                    y = -0.8;
                }

                particles_w[index].x = x;
                particles_w[index].y = y;
                particles_w[index].z = vx;
                particles_w[index].w = vy;
            }
        `
    });

    definePipeline();

    function updateParticles() {
        const currentTime = performance.now();

        const deltaTime = currentTime - lastTime;
        const deltaTimeInSeconds = deltaTime / 1000;

        time = Date.now();
        lastTime = currentTime;

        const timeArray = new Float32Array([time]);
        device.queue.writeBuffer(
            timeBuffer,
            0,
            timeArray.buffer,
            timeArray.byteOffset,
            timeArray.byteLength
        );

        const deltaTimeArray = new Float32Array([deltaTimeInSeconds]);
        device.queue.writeBuffer(
            deltaTimeBuffer,
            0,
            deltaTimeArray.buffer,
            deltaTimeArray.byteOffset,
            deltaTimeArray.byteLength
        );
    }


    // 描画のアップデート
    function update() {
        //カラーバッファ更新
        const uniformBufferUpdate = device.createBuffer({
            size: uniformBufferSize,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_SRC,
            mappedAtCreation: true,
        });
        new Float32Array(uniformBufferUpdate.getMappedRange()).set(color);
        uniformBufferUpdate.unmap();

        const commandEncoder = device.createCommandEncoder();
        //uniformBufferにuniformBufferUpdateをコピー
        commandEncoder.copyBufferToBuffer(
            uniformBufferUpdate,
            0,
            uniformBuffer,
            0,
            16
        );
        const passEncoder = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: context.getCurrentTexture().createView(),
                loadOp: 'clear',
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                storeOp: 'store',
            }],
        });
        passEncoder.setPipeline(pipeline);
        passEncoder.setBindGroup(0, bindGroup[0]);
        passEncoder.draw(numParticles);
        passEncoder.end();

        const encoder = device.createCommandEncoder();
        const computePass = encoder.beginComputePass();
        computePass.setPipeline(simulationPipeline);
        computePass.setBindGroup(0, bindGroup[step%2]);
        const workgroupCount = Math.ceil(numParticles / WORKGROUP_SIZE);
        computePass.dispatchWorkgroups(workgroupCount);
        computePass.end();

        device.queue.submit([commandEncoder.finish()]);

        step++;
    }

    // アニメーションループを設定
    function animationLoop() {
        updateParticles();  // パーティクルのデータを更新
        update();           // 画面に描画
        requestAnimationFrame(animationLoop);  // 次のフレームで再実行
    }

    animationLoop();  // アニメーションループを開始

}

main();

document.addEventListener('DOMContentLoaded', (event) => {
    const colorPicker = document.getElementById('colorPicker');

    colorPicker.addEventListener('input', (event) => {
        const colorCode = event.target.value;
        const pickColor = hexToVec3(colorCode);
        console.log('Selected color:', color);
        color = pickColor;
    });
});

document.addEventListener('DOMContentLoaded', (event) => {
    const count = document.getElementById('count');

    count.addEventListener('input', (event) => {
        const num = event.target.value;
        
        const diff = numParticles - num;

        //既存のバッファ+データを追加
        if(diff<0){
            const newParticlesData = new Float32Array(num * 4);

            for(let i=0;i<numParticles;i++){
                newParticlesData[i] = particlesData[i];
            }
            for(let i=numParticles;i<num;i++){
                newParticlesData[i * 4 + 0] = Math.random() * 2 - 1; // x
                newParticlesData[i * 4 + 1] = Math.random() * 2 - 1; // y
                newParticlesData[i * 4 + 2] = Math.random() * 0; // vx
                newParticlesData[i * 4 + 3] = Math.random() * 0; // vy
            }

            particlesData = newParticlesData;
            numParticles = num;
        }
        //既存のバッファから減らした分を新しいバッファを作成し、コピー
        else if(diff>0){
            const newParticlesData = new Float32Array(num * 4);

            for(let i=0;i<num;i++){
                newParticlesData[i] = particlesData[i];
            }

            particlesData = newParticlesData;
            numParticles = num;
        }      

        definePipeline();
    });
});

function hexToVec3(hex) {
    // Remove the hash symbol if present
    hex = hex.replace(/^#/, '');
    
    // Parse the hex color code
    const bigint = parseInt(hex, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    
    // Convert to vec3 (range 0 to 1)
    return [r / 255, g / 255, b / 255];
}

//グローバル変数を参照しているのでファイルを移動する際には注意
function definePipeline(){
    try{
        step = 0; //シーンを再定義するためstepは最初からのほうが安全
        particlesStorage = [
            device.createBuffer({
                label: "Particles A",
                size: particlesData.byteLength,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
                mappedAtCreation: true,
            }),
            device.createBuffer({
                label: "Particles B",
                size: particlesData.byteLength,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            })
            ];
        new Float32Array(particlesStorage[0].getMappedRange()).set(particlesData);
        particlesStorage[0].unmap();

        bindGroupLayout = device.createBindGroupLayout({
            entries: [
                {
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX,
                    buffer: {
                        type: 'uniform',
                        hasDynamicOffset: false,
                        minBindingSize: 64,  // 4x4 float matrix
                    },
                },
                {
                    binding: 1,
                    visibility: GPUShaderStage.VERTEX,
                    buffer: {
                        type: 'uniform',
                        hasDynamicOffset: false,
                        minBindingSize: 64,  // 4x4 float matrix
                    },
                },
                {
                    binding: 2,
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.COMPUTE,
                    buffer: {
                        type: 'read-only-storage',
                        hasDynamicOffset: false,
                        minBindingSize: particlesData.byteLength,
                    },
                },
                {
                    binding: 3,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: {
                        type: 'storage',
                        hasDynamicOffset: false,
                        minBindingSize: particlesData.byteLength,
                    }
                },
                {
                    binding: 4,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: {
                        type: 'uniform',
                        hasDynamicOffset: false,
                        minBindingSize: 16,
                    },
                },
                {
                    binding: 5,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: {
                        type: 'uniform',
                        hasDynamicOffset: false,
                        minBindingSize: 4,
                    },
                },
                {
                    binding: 6,
                    visibility: GPUShaderStage.COMPUTE,
                    buffer: {
                        type: 'uniform',
                        hasDynamicOffset: false,
                        minBindingSize: 4,
                    }
                }
            ],
        });

        // パイプラインレイアウトの作成
        pipelineLayout = device.createPipelineLayout({
            bindGroupLayouts: [bindGroupLayout]
        });

        // レンダリングパイプラインの設定
        pipeline = device.createRenderPipeline({
            label: "pipeline",
            layout: pipelineLayout,
            vertex: {
                module: shaderModule,
                entryPoint: 'vertexMain', // This should exactly match the function name in WGSL.
                buffers: []
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'fragmentMain',
                targets: [{
                    format: canvasFormat,
                }],
            },
            primitive: {
                topology: 'point-list',
            },
        });

        simulationPipeline = device.createComputePipeline({
            label: "Simulation pipeline",
            layout: pipelineLayout,
            compute: {
                module: simulationShaderModule,
                entryPoint: "computeMain",
            }
        });

        bindGroup = [
            device.createBindGroup({
                label: 'particles bind group A',
                layout: pipeline.getBindGroupLayout(0), // as defined in pipeline setup
                entries: [
                    { binding: 0, resource: { buffer: viewMatrixBuffer } },
                    { binding: 1, resource: { buffer: projMatrixBuffer } },
                    { binding: 2, resource: { buffer: particlesStorage[0] } },
                    { binding: 3, resource: { buffer: particlesStorage[1] } },
                    { binding: 4, resource: { buffer: uniformBuffer } },
                    { binding: 5, resource: { buffer: timeBuffer} },
                    { binding: 6, resource: { buffer: deltaTimeBuffer} },
                ],
            }),
            device.createBindGroup({
                label: 'particles bind group B',
                layout: pipeline.getBindGroupLayout(0), // as defined in pipeline setup
                entries: [
                    { binding: 0, resource: { buffer: viewMatrixBuffer } },
                    { binding: 1, resource: { buffer: projMatrixBuffer } },
                    { binding: 2, resource: { buffer: particlesStorage[1] } },
                    { binding: 3, resource: { buffer: particlesStorage[0] } },
                    { binding: 4, resource: { buffer: uniformBuffer} },
                    { binding: 5, resource: { buffer: timeBuffer} },
                    { binding: 6, resource: { buffer: deltaTimeBuffer} },
                ],
            }),
        ];
    } catch (error) {
        console.error("Error defining pipeline:", error);
    }
}
