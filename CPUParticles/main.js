import {getViewMatrix,getPerspectiveMatrix} from './matrix.js';

let color = [1,1,0];
let numParticles = 1000;
let particlesData;
let particlesBuffer;

let device;
let canvasFormat;
let shaderModule;
let bindGroupLayout;
let pipelineLayout;
let bindGroup;
let pipeline;

let viewMatrixBuffer;
let projMatrixBuffer;
let uniformBuffer;

async function main(app){
    const updateInterval = 100; 
    const particleSize = { x: 0.1, y: 0.1 }; 

    const canvas = document.querySelector("canvas");
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    let lastTime = performance.now();

    if (!navigator.gpu) {
        throw new Error("WebGPU not supported on this browser.");
    }
    
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
        throw new Error("No appropriate GPUAdapter found.");
    }
    device = await adapter.requestDevice();

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

    particlesBuffer = device.createBuffer({
        size: particlesData.byteLength,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
    });
    new Float32Array(particlesBuffer.getMappedRange()).set(particlesData);
    particlesBuffer.unmap();

    const uniformBufferSize = 4 * 4; //本来はvec3で4バイト×3で12バイトのはずだが、なぜか16バイト要求される。webgpuの仕様？
    uniformBuffer = device.createBuffer({
        size: uniformBufferSize,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        mappedAtCreation: true,
    });
    new Float32Array(uniformBuffer.getMappedRange()).set(color);
    uniformBuffer.unmap();

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

            @group(0) @binding(3) var<uniform> uniforms : Uniforms;

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

    // バインドグループレイアウトの定義
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
                visibility: GPUShaderStage.VERTEX,
                buffer: {
                    type: 'read-only-storage',
                    hasDynamicOffset: false,
                    minBindingSize: particlesData.byteLength,
                },
            },
            {
                binding: 3,
                visibility: GPUShaderStage.FRAGMENT,
                buffer: {
                    type: 'uniform',
                    hasDynamicOffset: false,
                    minBindingSize: 16,
                },
            },
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

    bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0), // as defined in pipeline setup
        entries: [
            { binding: 0, resource: { buffer: viewMatrixBuffer } },
            { binding: 1, resource: { buffer: projMatrixBuffer } },
            { binding: 2, resource: { buffer: particlesBuffer } },
            { binding: 3, resource: { buffer: uniformBuffer} },
        ],
    });

    function updateParticles() {
        const currentTime = performance.now();

        const deltaTime = currentTime - lastTime;
        const deltaTimeInSeconds = deltaTime / 1000;

        const time = Date.now() * 0.001;

        for (let i = 0; i < numParticles; i++) {
            let index = i * 4;
            let x = particlesData[index + 0];
            let y = particlesData[index + 1];
            let vx = particlesData[index + 2];
            let vy = particlesData[index + 3];

            let fx = 0;
            let fy = 0;
            fx += Math.sin(time + i) * 0.5; //x軸の力場
            fy += Math.cos(time + i) * 0.5; //y軸の力場

            vx += fx * deltaTimeInSeconds;
            vy += fy * deltaTimeInSeconds;

            x += vx * deltaTimeInSeconds;
            y += vy * deltaTimeInSeconds;

            //範囲の数値はカメラのパラメーターによって手動で調整、自動で算出できたら嬉しい
            if (x < -1) {
                x = 0.32;
            }
            if(x > 0.32){
                x = -1
            }
            if (y < -0.8) {
                y = 1;
            }
            if(y >= 1){
                y = -0.8
            }

            particlesData[index + 0] = x;
            particlesData[index + 1] = y;
            particlesData[index + 2] = vx;
            particlesData[index + 3] = vy;

            lastTime = currentTime;
        }

        // GPUバッファにデータをアップロード
        device.queue.writeBuffer(
            particlesBuffer,
            0,
            particlesData.buffer,
            particlesData.byteOffset,
            particlesData.byteLength
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
        passEncoder.setBindGroup(0, bindGroup);
        passEncoder.draw(numParticles);
        passEncoder.end();
        device.queue.submit([commandEncoder.finish()]);
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

        particlesBuffer = device.createBuffer({
            size: particlesData.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            mappedAtCreation: true,
        });
        new Float32Array(particlesBuffer.getMappedRange()).set(particlesData);
        particlesBuffer.unmap();

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
                    visibility: GPUShaderStage.VERTEX,
                    buffer: {
                        type: 'read-only-storage',
                        hasDynamicOffset: false,
                        minBindingSize: particlesData.byteLength,
                    },
                },
                {
                    binding: 3,
                    visibility: GPUShaderStage.FRAGMENT,
                    buffer: {
                        type: 'uniform',
                        hasDynamicOffset: false,
                        minBindingSize: 16,
                    },
                },
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

        bindGroup = device.createBindGroup({
            layout: bindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: viewMatrixBuffer } },
                { binding: 1, resource: { buffer: projMatrixBuffer } },
                { binding: 2, resource: { buffer: particlesBuffer } },
                { binding: 3, resource: { buffer: uniformBuffer} },
            ],
        });
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
