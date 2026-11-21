import type {ComputeBackendKind} from '../types/mantis';

export interface WebGpuProbeResult {
  supported: boolean;
  backend: ComputeBackendKind;
  adapterLabel: string;
  isFallbackAdapter: boolean;
}

interface GpuNavigatorLike {
  gpu?: {
    requestAdapter: (opts?: {powerPreference?: 'low-power' | 'high-performance'}) => Promise<GPUAdapterLike | null>;
  };
}

interface GPUAdapterLike {
  info?: {
    vendor?: string;
    architecture?: string;
    device?: string;
    description?: string;
  };
  isFallbackAdapter?: boolean;
  requestDevice: () => Promise<GPUDeviceLike>;
}

interface GPUDeviceLike {
  lost: Promise<{reason?: string; message?: string}>;
  createBuffer: (desc: {size: number; usage: number; mappedAtCreation?: boolean}) => GPUBufferLike;
  createShaderModule: (desc: {code: string}) => unknown;
  createComputePipeline: (desc: unknown) => unknown;
  createBindGroup: (desc: unknown) => unknown;
  createCommandEncoder: () => GPUCommandEncoderLike;
  queue: {
    writeBuffer: (buffer: GPUBufferLike, offset: number, data: ArrayBufferView) => void;
    submit: (cmds: unknown[]) => void;
  };
}

interface GPUBufferLike {
  getMappedRange: () => ArrayBuffer;
  unmap: () => void;
  mapAsync: (mode: number) => Promise<void>;
  destroy: () => void;
}

interface GPUCommandEncoderLike {
  beginComputePass: () => {
    setPipeline: (p: unknown) => void;
    setBindGroup: (idx: number, bg: unknown) => void;
    dispatchWorkgroups: (x: number) => void;
    end: () => void;
  };
  copyBufferToBuffer: (
    src: GPUBufferLike,
    srcOffset: number,
    dst: GPUBufferLike,
    dstOffset: number,
    size: number,
  ) => void;
  finish: () => unknown;
}

const GPU_BUFFER_USAGE = {
  MAP_READ: 0x0001,
  COPY_SRC: 0x0004,
  COPY_DST: 0x0008,
  STORAGE: 0x0080,
  UNIFORM: 0x0040,
};

let cachedProbe: WebGpuProbeResult | null = null;
let cachedDevice: GPUDeviceLike | null = null;

/**
 * Probes Chrome's WebGPU adapter (backed by Vulkan via Dawn on Android & ChromeOS).
 * Never throws or blocks if WebGPU is disabled or unsupported.
 */
export async function probeWebGpuHardware(): Promise<WebGpuProbeResult> {
  if (cachedProbe) return cachedProbe;

  const nav = typeof navigator !== 'undefined' ? (navigator as unknown as GpuNavigatorLike) : undefined;
  if (!nav?.gpu || typeof nav.gpu.requestAdapter !== 'function') {
    cachedProbe = {
      supported: false,
      backend: typeof Worker !== 'undefined' ? 'worker-wasm' : 'main-thread',
      adapterLabel: typeof Worker !== 'undefined' ? 'Web Worker Compute' : 'CPU Main Thread',
      isFallbackAdapter: false,
    };
    return cachedProbe;
  }

  try {
    const adapter = await nav.gpu.requestAdapter({powerPreference: 'low-power'});
    if (!adapter) {
      cachedProbe = {
        supported: false,
        backend: typeof Worker !== 'undefined' ? 'worker-wasm' : 'main-thread',
        adapterLabel: 'Worker Compute (No GPU Adapter)',
        isFallbackAdapter: false,
      };
      return cachedProbe;
    }

    const info = adapter.info || {};
    const parts = [info.vendor, info.architecture, info.description || info.device]
      .filter(Boolean)
      .map((s) => String(s).trim());
    const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
    const isVulkanHost = /Android|CrOS|Linux/i.test(ua) && !adapter.isFallbackAdapter;
    const rawLabel = parts.length > 0 ? parts.join(' · ') : isVulkanHost ? 'Vulkan Dawn GPU' : 'WebGPU Adapter';

    cachedProbe = {
      supported: true,
      backend: isVulkanHost ? 'webgpu-vulkan' : 'webgpu',
      adapterLabel: isVulkanHost ? `${rawLabel} (Vulkan WebGPU)` : `${rawLabel} (WebGPU)`,
      isFallbackAdapter: Boolean(adapter.isFallbackAdapter),
    };
    return cachedProbe;
  } catch {
    cachedProbe = {
      supported: false,
      backend: typeof Worker !== 'undefined' ? 'worker-wasm' : 'main-thread',
      adapterLabel: 'Worker Compute',
      isFallbackAdapter: false,
    };
    return cachedProbe;
  }
}

async function getOrCreateGpuDevice(): Promise<GPUDeviceLike | null> {
  if (cachedDevice) return cachedDevice;
  const nav = typeof navigator !== 'undefined' ? (navigator as unknown as GpuNavigatorLike) : undefined;
  if (!nav?.gpu) return null;
  try {
    const adapter = await nav.gpu.requestAdapter({powerPreference: 'low-power'});
    if (!adapter) return null;
    const device = await adapter.requestDevice();
    cachedDevice = device;
    void device.lost.then(() => {
      cachedDevice = null;
    });
    return device;
  } catch {
    return null;
  }
}

const COSINE_WGSL = /* wgsl */ `
struct Params {
  count: u32,
  dims: u32,
};

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> queryVec: array<f32>;
@group(0) @binding(2) var<storage, read> matrix: array<f32>;
@group(0) @binding(3) var<storage, read_write> outScores: array<f32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let row = gid.x;
  if (row >= params.count) {
    return;
  }
  let base = row * params.dims;
  var dot: f32 = 0.0;
  for (var i: u32 = 0u; i < params.dims; i = i + 1u) {
    dot = dot + queryVec[i] * matrix[base + i];
  }
  outScores[row] = dot;
}
`;

/**
 * Hardware-accelerated WGSL WebGPU batch dot-product (cosine similarity over L2-normalized vectors).
 * Automatically falls back cleanly to fast typed-array CPU loop on small batches or unsupported hardware.
 */
export async function webGpuBatchCosine(
  query: Float32Array,
  dequantizedMatrix: Float32Array,
  rowCount: number,
  dims: number,
): Promise<Float32Array | null> {
  if (rowCount < 64) return null; // CPU loop is faster under 64 vectors due to GPU dispatch overhead
  const device = await getOrCreateGpuDevice();
  if (!device) return null;

  const buffersToDestroy: GPUBufferLike[] = [];
  try {
    const paramBuffer = device.createBuffer({
      size: 16,
      usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
    });
    buffersToDestroy.push(paramBuffer);
    device.queue.writeBuffer(paramBuffer, 0, new Uint32Array([rowCount, dims, 0, 0]));

    const queryBuffer = device.createBuffer({
      size: query.byteLength,
      usage: GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST,
    });
    buffersToDestroy.push(queryBuffer);
    device.queue.writeBuffer(queryBuffer, 0, query);

    const matrixBuffer = device.createBuffer({
      size: dequantizedMatrix.byteLength,
      usage: GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST,
    });
    buffersToDestroy.push(matrixBuffer);
    device.queue.writeBuffer(matrixBuffer, 0, dequantizedMatrix);

    const outByteSize = rowCount * 4;
    const outputBuffer = device.createBuffer({
      size: outByteSize,
      usage: GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_SRC,
    });
    const readbackBuffer = device.createBuffer({
      size: outByteSize,
      usage: GPU_BUFFER_USAGE.MAP_READ | GPU_BUFFER_USAGE.COPY_DST,
    });
    buffersToDestroy.push(outputBuffer, readbackBuffer);

    const shaderModule = device.createShaderModule({code: COSINE_WGSL});
    const pipeline = device.createComputePipeline({
      layout: 'auto',
      compute: {module: shaderModule, entryPoint: 'main'},
    }) as {getBindGroupLayout: (i: number) => unknown};

    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries: [
        {binding: 0, resource: {buffer: paramBuffer}},
        {binding: 1, resource: {buffer: queryBuffer}},
        {binding: 2, resource: {buffer: matrixBuffer}},
        {binding: 3, resource: {buffer: outBufferResource(outputBuffer)}},
      ],
    });

    const encoder = device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(Math.ceil(rowCount / 64));
    pass.end();
    encoder.copyBufferToBuffer(outputBuffer, 0, readbackBuffer, 0, outByteSize);
    device.queue.submit([encoder.finish()]);

    await readbackBuffer.mapAsync(1);
    const mapped = new Float32Array(readbackBuffer.getMappedRange().slice(0));
    readbackBuffer.unmap();
    return mapped;
  } catch {
    return null;
  } finally {
    for (const buf of buffersToDestroy) {
      try {
        buf.destroy();
      } catch {
        // ignore cleanup failure
      }
    }
  }
}

function outBufferResource(buffer: GPUBufferLike) {
  return {buffer};
}
