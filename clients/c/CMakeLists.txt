cmake_minimum_required(VERSION 3.16)
project(nalix_c C)

set(CMAKE_C_STANDARD 99)
set(CMAKE_C_STANDARD_REQUIRED ON)

include_directories(
    include
    src
)

add_library(nalix_c STATIC
    src/status.c
    src/packet.c
    src/compression.c
    src/security.c
    src/handshake.c
    src/pipeline.c
    src/session.c
    src/third_party/lz4/lz4.c
    src/third_party/monocypher/monocypher.c
    src/third_party/keccak/keccak256.c
)

target_include_directories(nalix_c PUBLIC
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/include>
    $<BUILD_INTERFACE:${CMAKE_CURRENT_SOURCE_DIR}/src>
    $<INSTALL_INTERFACE:include>
)

if(WIN32)
    target_link_libraries(nalix_c PUBLIC ws2_32)
endif()

enable_testing()
add_executable(nalix_c_test tests/session_test.c)
target_link_libraries(nalix_c_test PRIVATE nalix_c)
add_test(NAME nalix_c_test COMMAND nalix_c_test)
