export default class VideoProcessor {
  #mp4Demuxer

  /**
   * 
   * @param {object} options 
   * @param {import('./mp4Demuxer.js').default} options.mp4Demuxer
   */
  constructor({ mp4Demuxer }) {
    this.#mp4Demuxer = mp4Demuxer
  }
  
  /** @returns {ReadableStream} */
  mp4Decoder(stream) {
    return new ReadableStream({
      start: async (controller) => {
        const decoder = new VideoDecoder({
          /** @param {VideoFrame} frame */
          output(frame) {
            controller.enqueue(frame)
          },
    
          error(e) {
            console.error('Error at mp4Decoder', e)
            controller.error(e)
          }
        })
    
        return this.#mp4Demuxer.run(stream, {
          async onConfig(config) {
            const { supported } = await VideoDecoder.isConfigSupported(config)

            if(!supported) {
              console.error('Unsupported codec', config)
              controller.close()
              return
            }
            decoder.configure(config)
          },
          /** @param {EncodedVideoChunk} chunk */
          onChunk(chunk) {
            decoder.decode(chunk)
          }
        })
      }
    })
  }

  encode144p(encoderConfig) {
    let _encoder

    const readable = new ReadableStream({
      start: async (controller) => {
        const { supported } = await VideoEncoder.isConfigSupported(encoderConfig)

        if(!supported) {
          const errorMessage = 'encode144p VideoEncoder config not supported'

          console.error(errorMessage, encoderConfig)
          controller.error(errorMessage)

          return
        }
        _encoder = new VideoEncoder({
          /**
           * 
           * @param {EncodedVideoChunk} frame 
           * @param {EncodedVideoChunkMetadata} config 
           */
          output: (frame, config) => {
            if(config.decoderConfig) {
              const decoderConfig = {
                type: 'config',
                config: config.decoderConfig
              }
              controller.enqueue(decoderConfig)
            }
            controller.enqueue(frame)
          },
          error: (err) => {
            console.error('VideoEncoder 144p', err)
            controller.error(err)
          }
        })

        await _encoder.configure(encoderConfig)
      }
    })

    const writable = new WritableStream({
      async write(frame) {
        _encoder.encode(frame)
        frame.close()
      }
    })

    return {
      readable,
      writable,
    }
  }

  renderDecodedFramesAndGetEncodedChunks(renderFrame) {
    let _decoder
    return new TransformStream({
      start: (controller) => {
        _decoder = new VideoDecoder({
          output(frame) {
             renderFrame(frame)
          },
          error(err) {
            console.error('Error rendering frames at 144p', err)
            controller.error(err)
          }
        })
      },
      /**
       * 
       * @param {EncodedVideoChunk} encodedChunk 
       * @param {TransformStreamDefaultController} controller 
       */
      async transform(encodedChunk, controller) {
        if(encodedChunk.type === 'config') {
          await _decoder.configure(encodedChunk.config)
          return
        }

        _decoder.decode(encodedChunk)
        // need the encoded version to use webM
        controller.enqueue(encodedChunk)
      }
    })
  }

  async start({ file, encoderConfig, renderFrame }) {
    const stream = file.stream()
    const filename = file.name.split('/').pop().replace('.mp4', '')
    await this.mp4Decoder(stream)
      .pipeThrough(this.encode144p(encoderConfig))
      .pipeThrough(this.renderDecodedFramesAndGetEncodedChunks(renderFrame))
      .pipeTo(new WritableStream({
        write(frame) {
          // renderFrame(frame)
        }
      }))
  }
}