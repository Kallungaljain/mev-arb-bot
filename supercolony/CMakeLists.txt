cmake_minimum_required(VERSION 3.20)
project(MEVSupercolony CXX)

# C++20 with aggressive optimizations
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_FLAGS_RELEASE "-O3 -march=native -flto -ffast-math -funroll-loops -DNDEBUG")
set(CMAKE_CXX_FLAGS_DEBUG "-g -O0 -Wall -Wextra -Wpedantic")

# Default to Release build
if(NOT CMAKE_BUILD_TYPE)
  set(CMAKE_BUILD_TYPE Release)
endif()

# Link-time optimization
set(CMAKE_INTERPROCEDURAL_OPTIMIZATION TRUE)

# Find required packages
find_package(Boost 1.75 REQUIRED COMPONENTS system thread)
find_package(OpenSSL REQUIRED)
find_package(Threads REQUIRED)

# Include directories
include_directories(${CMAKE_CURRENT_SOURCE_DIR}/include)

# Source files
set(SUPERCOLONY_SOURCES
    src/pool_monitor.cpp
    src/detection_engine.cpp
    src/transaction_builder.cpp
    src/mev_protection.cpp
    src/transaction_executor.cpp
    src/worker_group.cpp
    src/pheromone_broadcaster.cpp
    src/queen.cpp
    src/supercolony.cpp
)

# Create main library
add_library(supercolony_core STATIC ${SUPERCOLONY_SOURCES})
target_link_libraries(supercolony_core 
    PUBLIC
        Boost::system
        Boost::thread
        OpenSSL::Crypto
        OpenSSL::SSL
        Threads::Threads
)

# Main executable
add_executable(supercolony_engine src/main.cpp)
target_link_libraries(supercolony_engine supercolony_core)

# Testing
enable_testing()

# Unit tests
add_executable(supercolony_tests
    test/pool_monitor_test.cpp
    test/detection_test.cpp
    test/transaction_test.cpp
)
target_link_libraries(supercolony_tests supercolony_core)
add_test(NAME SupercolonyTests COMMAND supercolony_tests)

# Benchmarks
add_executable(supercolony_bench
    benchmark/latency_benchmark.cpp
)
target_link_libraries(supercolony_bench supercolony_core)

# Print build configuration
message(STATUS "Build type: ${CMAKE_BUILD_TYPE}")
message(STATUS "C++ Standard: ${CMAKE_CXX_STANDARD}")
message(STATUS "Compiler: ${CMAKE_CXX_COMPILER}")
message(STATUS "Flags: ${CMAKE_CXX_FLAGS_${CMAKE_BUILD_TYPE}}")
