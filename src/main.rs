/* SPDX-License-Identifier: AGPL-3.0-or-later
 *
 * Copyright (C) 2025 The OpenPSG Authors.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published
 * by the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

#![cfg_attr(not(test), no_std)]
#![cfg_attr(not(test), no_main)]

use crate::api::RpcHandler;
//use crate::cs1237::{Channel, Config as Cs1237Config, Cs1237, Gain, SamplesPerSecond};
use crate::net_util::generate_mac_address;
use crate::task::TaskSignal;
use crate::time::{clock_gettime, clock_settime, init_time, Timespec};
use core::net::{IpAddr, SocketAddr};
use core::option::Option::*;
use core::result::Result::*;
use defmt::{debug, error, info, warn};
use embassy_executor::Spawner;
use embassy_net::tcp::{Error as TcpReadError, TcpSocket};
use embassy_net::udp::{PacketMetadata, UdpSocket};
use embassy_net::{Stack, StackResources};
use embassy_stm32::eth::generic_smi::GenericSMI;
use embassy_stm32::eth::{Ethernet, PacketQueue};
use embassy_stm32::peripherals::ETH;
use embassy_stm32::rng::Rng;
use embassy_stm32::time::Hertz;
use embassy_stm32::{bind_interrupts, eth, peripherals, rng, Config};
use embassy_sync::blocking_mutex::raw::ThreadModeRawMutex;
use embassy_sync::signal::Signal as EmbassySignal;
use embassy_time::{Duration, Timer};
use embedded_jsonrpc::RpcServer;
use rand_core::RngCore;
use static_cell::StaticCell;
use {defmt_rtt as _, panic_probe as _};

mod api;
mod biquad_filter;
mod cs1237;
mod ncpt;
mod net_util;
mod task;
mod time;

bind_interrupts!(struct Irqs {
    ETH => eth::InterruptHandler;
    RNG => rng::InterruptHandler<peripherals::RNG>;
});

type Device = Ethernet<'static, ETH, GenericSMI>;

const NTP_PORT: u16 = 123;
const NTP_PACKET_SIZE: usize = 48;

#[embassy_executor::task]
async fn net_task(mut runner: embassy_net::Runner<'static, Device>) -> ! {
    runner.run().await
}

#[embassy_executor::task]
async fn timesync_task(stack: Stack<'static>) -> ! {
    let timestamp_gen = TimestampGen::default();
    let context = sntpc::NtpContext::new(timestamp_gen);

    let mut rx_meta = [PacketMetadata::EMPTY; 1];
    let mut rx_buffer = [0; NTP_PACKET_SIZE];
    let mut tx_meta = [PacketMetadata::EMPTY; 1];
    let mut tx_buffer = [0; NTP_PACKET_SIZE];

    let mut socket = UdpSocket::new(
        stack,
        &mut rx_meta,
        &mut rx_buffer,
        &mut tx_meta,
        &mut tx_buffer,
    );
    socket.bind(NTP_PORT).unwrap();

    // Get the address of the network gateway.
    let gateway = stack.config_v4().unwrap().gateway;
    if gateway.is_none() {
        panic!("Expected a gateway address");
    }

    let ntp_addr = SocketAddr::new(IpAddr::V4(gateway.unwrap()), NTP_PORT);

    loop {
        match sntpc::get_time(ntp_addr, &socket, context).await {
            Ok(time) => {
                clock_settime(&Timespec {
                    seconds: time.sec() as u64,
                    micros: (u64::from(time.sec_fraction()) * 1_000_000 / u64::from(u32::MAX))
                        as u32,
                })
                .unwrap();

                debug!("Time synchronized: {:?}", time);
            }
            Err(err) => {
                error!("Time synchronization error: {:?}", err);
            }
        }

        Timer::after(Duration::from_secs(20)).await;
    }
}

#[embassy_executor::main]
async fn main(spawner: Spawner) -> ! {
    debug!("Starting...");

    let mut config = Config::default();
    {
        use embassy_stm32::rcc::*;
        config.rcc.hse = Some(Hse {
            freq: Hertz(8_000_000),
            mode: HseMode::Oscillator,
        });
        config.rcc.pll_src = PllSource::HSE;
        config.rcc.pll = Some(Pll {
            prediv: PllPreDiv::DIV8,
            mul: PllMul::MUL336,
            divp: Some(PllPDiv::DIV2), // 8mhz / 8 * 336 / 2 = 168Mhz.
            divq: Some(PllQDiv::DIV7), // 8mhz / 8 * 336 / 7 = 48Mhz.
            divr: None,
        });
        config.rcc.ahb_pre = AHBPrescaler::DIV1;
        config.rcc.apb1_pre = APBPrescaler::DIV4;
        config.rcc.apb2_pre = APBPrescaler::DIV2;
        config.rcc.sys = Sysclk::PLL1_P;
        config.rcc.ls = LsConfig::default_lse();
    }

    debug!("Initializing clocks...");

    let p = embassy_stm32::init(config);

    // Initialize peripherals
   /*  let ncpt_adc = Cs1237::try_new(
        p.SPI1,
        p.PA5,
        p.PA6,
        p.DMA2_CH3,
        p.DMA2_CH2,
        p.EXTI6,
        Cs1237Config {
            sample_rate: SamplesPerSecond::SPS40,
            gain: Gain::G128,
            channel: Channel::ChannelA,
        },
    )
    .await
    .unwrap();
*/
    // Initialize the RTC.
    debug!("Initializing RTC...");
    init_time(p.RTC);

    // Generate random seed.
    debug!("Generating random ethernet seed...");
    let mut rng = Rng::new(p.RNG, Irqs);
    let mut seed = [0; 8];
    rng.fill_bytes(&mut seed);
    let seed = u64::from_le_bytes(seed);

    // Initialize Ethernet device.
    debug!("Initializing Ethernet device...");
    let mac_addr = generate_mac_address();

    static PACKETS: StaticCell<PacketQueue<4, 4>> = StaticCell::new();
    let packet_queue = PACKETS.init(PacketQueue::<4, 4>::new());

    debug!("Bringing up Ethernet device...");

    let device = Ethernet::new(
        packet_queue,
        p.ETH,
        Irqs,
        p.PA1,
        p.PA2,
        p.PC1,
        p.PA7,
        p.PC4,
        p.PC5,
        p.PB12,
        p.PB13,
        p.PB11,
        GenericSMI::new(1), // The default dp83848 address is "1" unlike the LAN8742 which is "0".
        mac_addr,
    );

    // Acquire network configuration using DHCP.
    let config = embassy_net::Config::dhcpv4(embassy_net::DhcpConfig::default());

    // Init network stack
    static RESOURCES: StaticCell<StackResources<3>> = StaticCell::new();
    let (stack, runner) =
        embassy_net::new(device, config, RESOURCES.init(StackResources::new()), seed);

    // Launch network task
    spawner.spawn(net_task(runner)).unwrap();

    // Ensure DHCP configuration is up before trying connect
    stack.wait_config_up().await;

    // Begin synchronizing time with NTP server.
    spawner.spawn(timesync_task(stack)).unwrap();

    // Create JSON-RPC server
    static RPC_SERVER: StaticCell<RpcServer<'static, TcpReadError>> = StaticCell::new();
    let rpc_server = RPC_SERVER.init_with(RpcServer::new);

    // Task signals.
    static NCPT_SAMPLING_TASK_SIGNALS: StaticCell<EmbassySignal<ThreadModeRawMutex, TaskSignal>> =
        StaticCell::new();
    let ncpt_sampling_task_signals = NCPT_SAMPLING_TASK_SIGNALS.init_with(EmbassySignal::new);

    // Register handlers.
    static RPC_HANDLER: StaticCell<RpcHandler> = StaticCell::new();
    let rpc_handler = RPC_HANDLER.init_with(|| RpcHandler::new(ncpt_sampling_task_signals));

    rpc_server
        .register_handler("openpsg.*", rpc_handler)
        .unwrap();

    // Launch pressure transducer sampling task.
  /*  spawner
        .spawn(ncpt::sample(
            rpc_server,
            ncpt_sampling_task_signals,
            ncpt_adc,
        ))
        .unwrap();
 */
    let mut rx_buffer = [0; 128]; // Received commands are nice and small.
    let mut tx_buffer = [0; 1460]; // One Ethernet frame worth of data.

    loop {
        let mut socket = TcpSocket::new(stack, &mut rx_buffer, &mut tx_buffer);
        socket.set_timeout(Some(embassy_time::Duration::from_secs(10)));
        socket.set_keep_alive(Some(embassy_time::Duration::from_secs(5)));

        if let Err(e) = socket.accept(80).await {
            warn!("Accept error: {:?}", e);
            continue;
        }

        info!(
            "Received connection from {:?}",
            socket.remote_endpoint().unwrap()
        );

        // Serve the JSON-RPC requests on the socket
        if let Err(e) = rpc_server.serve(&mut socket).await {
            warn!("JSON-RPC error: {:?}", e);
        }

        info!("Connection closed");
    }
}

#[derive(Clone, Copy, Default)]
struct TimestampGen {
    now: u64,
    now_micros: u32,
}

impl sntpc::NtpTimestampGenerator for TimestampGen {
    fn init(&mut self) {
        let tp = clock_gettime().unwrap();
        self.now = tp.seconds;
        self.now_micros = tp.micros;
    }

    fn timestamp_sec(&self) -> u64 {
        self.now
    }

    fn timestamp_subsec_micros(&self) -> u32 {
        self.now_micros
    }
}
