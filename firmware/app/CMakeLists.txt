cmake_minimum_required(VERSION 3.20.0)

# Board definition lives in this app (boards/discyboi).
list(APPEND BOARD_ROOT ${CMAKE_CURRENT_SOURCE_DIR})
list(APPEND DTS_ROOT ${CMAKE_CURRENT_SOURCE_DIR})

find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(discyboi)

target_sources(app PRIVATE
  src/main.c
  src/imu.c
  src/capture.c
  src/analysis.c
  src/ble.c
  src/battery.c
  src/led.c
)
